// Strictly local vocabulary rules: no network or AI calls. Keys are scoped by language + type.
const entries = {
  zh: {
    word: {
      工作:['Công việc','work'],上班:['Đi làm','work'],下班:['Tan làm','work'],确认:['Xác nhận','work'],
      处理:['Xử lý','work'],问题:['Vấn đề','work'],解决:['Giải quyết','work'],完成:['Hoàn thành','work'],
      需要:['Cần','both'],帮忙:['Giúp đỡ','both'],麻烦:['Phiền, làm phiền','both'],
      订单:['Đơn hàng','work'],审核:['Kiểm duyệt','work'],申请:['Yêu cầu, đăng ký','work'],
      支付:['Thanh toán','work'],付款:['Trả tiền','work'],工资:['Tiền lương','work'],
      同事:['Đồng nghiệp','work'],老板:['Sếp','work'],经理:['Quản lý','work'],
      已经:['Đã','both'],现在:['Bây giờ','both'],马上:['Ngay lập tức','both'],
      今天:['Hôm nay','both'],明天:['Ngày mai','both'],昨天:['Hôm qua','both'],
      吃饭:['Ăn cơm','daily_life'],喝水:['Uống nước','daily_life'],睡觉:['Ngủ','daily_life'],
      起床:['Thức dậy','daily_life'],洗澡:['Tắm','daily_life'],刷牙:['Đánh răng','daily_life'],
      买菜:['Mua thức ăn, rau','daily_life'],超市:['Siêu thị','daily_life'],
      回家:['Về nhà','daily_life'],衣服:['Quần áo','daily_life'],
      天气:['Thời tiết','daily_life'],朋友:['Bạn bè','daily_life'],
      喜欢:['Thích','daily_life'],谢谢:['Cảm ơn','both'],对不起:['Xin lỗi','both'],
      知道:['Biết','both'],明白:['Hiểu','both']
    },
    phrase: {
      确认一下:['Xác nhận giúp một chút','work'],麻烦你:['Phiền bạn','work'],
      麻烦您:['Phiền anh/chị (lịch sự)','work'],请稍等:['Vui lòng đợi một chút','work'],
      等一下:['Đợi một chút','both'],处理好了:['Đã xử lý xong','work'],
      已经处理好了:['Đã xử lý xong rồi','work'],
      下班以后:['Sau khi tan làm','daily_life'],
      什么时候:['Khi nào','both'],多少钱:['Bao nhiêu tiền','daily_life'],
      不客气:['Không có gì','daily_life']
    }
  },
  en: {
    word: {
      confirm:['Xác nhận','work'],process:['Xử lý, quy trình','work'],
      problem:['Vấn đề','work'],solve:['Giải quyết','work'],complete:['Hoàn tất','work'],
      meeting:['Cuộc họp','work'],manager:['Quản lý','work'],deadline:['Hạn chót','work'],
      report:['Báo cáo','work'],task:['Nhiệm vụ','work'],approve:['Phê duyệt','work'],
      approval:['Sự phê duyệt','work'],order:['Đơn hàng','work'],payment:['Thanh toán','work'],
      urgent:['Khẩn cấp','work'],review:['Kiểm tra, xem xét','work'],
      update:['Cập nhật','work'],issue:['Vấn đề phát sinh','work'],
      colleague:['Đồng nghiệp','work'],office:['Văn phòng','work'],
      dinner:['Bữa tối','daily_life'],lunch:['Bữa trưa','daily_life'],
      breakfast:['Bữa sáng','daily_life'],home:['Nhà','daily_life'],
      buy:['Mua','daily_life'],sleep:['Ngủ','daily_life'],wake:['Thức dậy','daily_life'],
      water:['Nước','daily_life'],grocery:['Thực phẩm','daily_life'],
      supermarket:['Siêu thị','daily_life'],weather:['Thời tiết','daily_life'],
      friend:['Bạn bè','daily_life'],thanks:['Cảm ơn','both'],
      please:['Làm ơn','both'],already:['Đã','both'],today:['Hôm nay','both'],
      tomorrow:['Ngày mai','both'],yesterday:['Hôm qua','both'],
      ready:['Sẵn sàng','both'],help:['Giúp đỡ','both']
    },
    phrase: {
      'please confirm':['Vui lòng xác nhận','work'],
      'give me a moment':['Cho tôi một chút thời gian','both'],
      'let me check':['Để tôi kiểm tra','work'],
      'get back to you':['Phản hồi lại bạn sau','work'],
      'as soon as possible':['Sớm nhất có thể','work'],
      'could you please':['Bạn có thể vui lòng...','work'],
      'thank you':['Cảm ơn bạn','both'],
      'see you later':['Hẹn gặp lại','daily_life']
    }
  }
};
const patterns = {
  zh: [
    { key:'A以后，B', regex:/.{1,16}以后[，, ]+.{1,25}/u, meaning:'Sau khi A thì B', category:'daily_life' },
    { key:'因为A，所以B', regex:/因为.{1,30}所以.{1,35}/u, meaning:'Vì A nên B', category:'both' },
    { key:'如果A，就B', regex:/如果.{1,30}就.{1,35}/u, meaning:'Nếu A thì B', category:'both' },
    { key:'V完了', regex:/[\u3400-\u9fff]{1,4}完了/u, meaning:'Đã làm xong việc gì đó', category:'both' }
  ],
  en: [
    { key:'Could you (please) + V ...?', regex:/\bcould\s+you\s+(?:please\s+)?[a-z]+/i, meaning:'Bạn có thể vui lòng làm gì đó không?', category:'work' },
    { key:'Have you + V3 ... yet?', regex:/\bhave\s+you\b[^.!?]{1,60}\byet\b/i, meaning:'Bạn đã ... chưa?', category:'both' },
    { key:'Please + V ...', regex:/\bplease\s+(?:check|confirm|send|help|review|wait|update)\b/i, meaning:'Vui lòng làm một việc gì đó', category:'work' }
  ]
};
module.exports = { entries, patterns };
