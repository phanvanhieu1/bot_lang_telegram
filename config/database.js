const mongoose = require('mongoose');

async function connectDatabase() {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 10000
    });

    console.log('✅ MongoDB connected');
    console.log(`Database: ${mongoose.connection.name}`);
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error.message);
    throw error;
  }
}

module.exports = connectDatabase;