'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function mockedPreferences() {
  const file = fs.readFileSync(path.join(__dirname,'..','telegram-sync','preferences.js'),'utf8');
  const user = { targetLang:'zh', voiceKey:'female1', speed:1, showVocabulary:true };
  const writes = [];
  const store = new Map();
  class Schema { index() {} }
  const mongoose = {
    Schema, connection:{readyState:1}, models:{},
    model:()=>model
  };
  const model = {
    findOne:(query)=>({
      select:()=>({lean:async()=>store.get(query.namespace+':'+query.telegramId) || null})
    }),
    updateOne:async(query, update)=>{
      writes.push({query,update});
      store.set(query.namespace+':'+query.telegramId,{preferences:update.$set.preferences});
    }
  };
  const box = { module:{exports:{}}, require:name=>{
    if(name==='mongoose')return mongoose;
    if(name==='../session')return {getUserConfig:()=>user};
    throw Error('Unexpected module '+name);
  }, process:{env:{TELEGRAM_TEST_MODE:'1'}}, console };
  vm.runInNewContext(file,box);
  return {handler:box.module.exports.syncTelegramPreferences,user,writes,store};
}

test('MongoDB settings writes happen on first load and when changed, not on every message',async()=>{
  const m = mockedPreferences();
  const ctx = { from:{id:12345678} };
  await m.handler(ctx,async()=>{});
  assert.equal(m.writes.length,1);
  for(let i=0;i<12;i++)await m.handler(ctx,async()=>{});
  assert.equal(m.writes.length,1,'read-only updates must not write database');
  await m.handler(ctx,async()=>{m.user.showVocabulary=false;});
  assert.equal(m.writes.length,2);
  assert.equal(m.writes.at(-1).update.$set.preferences.showVocabulary,false);
});

test('simultaneous Telegram updates for one user are serialized',async()=>{
  const m=mockedPreferences(),ctx={from:{id:12345679}},order=[];
  await Promise.all([
    m.handler(ctx,async()=>{order.push('first:start');await new Promise(ok=>setTimeout(ok,15));order.push('first:end');}),
    m.handler(ctx,async()=>{order.push('second:start');order.push('second:end');})
  ]);
  assert.deepEqual(order,['first:start','first:end','second:start','second:end']);
});

test('legacy session JSON continues to be readable but new writes are atomic',()=>{
  const file=fs.readFileSync(path.join(__dirname,'..','session.js'),'utf8');
  assert.match(file,/function atomicWrite\(/);
  assert.match(file,/fs\.renameSync\(temp, file\)/);
  assert.match(file,/getVocabulary/);
  assert.doesNotMatch(file,/const saveVocabulary =/);
  assert.doesNotMatch(file,/const clearVocabulary =/);
});

test('bot cannot expose linked vocabulary in group chats',()=>{
  const bot=fs.readFileSync(path.join(__dirname,'..','bot.js'),'utf8');
  const exportHandler=bot.slice(bot.indexOf("bot.command('export',"),bot.indexOf("bot.command('exportlocal',"));
  const localHandler=bot.slice(bot.indexOf("bot.command('exportlocal',"),bot.indexOf("bot.command('clearvocab',"));
  assert.match(exportHandler,/ctx\.chat\?\.type !== 'private'/);
  assert.match(localHandler,/ctx\.chat\?\.type !== 'private'/);
});

test('shared web and offline MP3 cache APIs have one responsible implementation',()=>{
  const cache=fs.readFileSync(path.join(__dirname,'..','cache.js'),'utf8');
  const web=fs.readFileSync(path.join(__dirname,'..','web-cache.js'),'utf8');
  assert.doesNotMatch(cache,/setWebCachedText|getFreeCachedText|getCachedText/);
  assert.match(cache,/function getCachedAudio/);
  assert.match(cache,/function clearAudioCache/);
  assert.match(web,/async function getWebCachedText/);
  assert.match(web,/async function setWebCachedText/);
});
