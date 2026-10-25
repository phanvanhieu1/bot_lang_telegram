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
      知道:['Biết','both'],明白:['Hiểu','both'],多久:['Bao lâu','both'],
      回复:['Trả lời','work'],信息:['Thông tin, tin nhắn','both'],
      负责:['Phụ trách','work'],更新:['Cập nhật','work'],
      状态:['Trạng thái','work'],账户:['Tài khoản','work'],
      系统:['Hệ thống','work'],余额:['Số dư','work'],
      失败:['Thất bại','both'],成功:['Thành công','both'],
      等待:['Chờ đợi','both'],通过:['Thông qua','work'],
      拒绝:['Từ chối','both'],时间:['Thời gian','both'],
      客户:['Khách hàng','work'],结果:['Kết quả','both'],
      联系:['Liên hệ','both'],发送:['Gửi','work'],
      收到:['Nhận được','both'],检查:['Kiểm tra','work'],
      查询:['Tra cứu','work'],提现:['Rút tiền','work'],
      转账:['Chuyển khoản','work'],金额:['Số tiền','work'],
      记录:['Ghi chép, bản ghi','work'],电话:['Điện thoại','daily_life'],
      电脑:['Máy tính','both'],手机:['Điện thoại di động','daily_life']
    },
    phrase: {
      确认一下:['Xác nhận giúp một chút','work'],麻烦你:['Phiền bạn','work'],
      麻烦您:['Phiền anh/chị (lịch sự)','work'],请稍等:['Vui lòng đợi một chút','work'],
      等一下:['Đợi một chút','both'],处理好了:['Đã xử lý xong','work'],
      已经处理好了:['Đã xử lý xong rồi','work'],
      下班以后:['Sau khi tan làm','daily_life'],
      什么时候:['Khi nào','both'],多少钱:['Bao nhiêu tiền','daily_life'],
      不客气:['Không có gì','daily_life'],没问题:['Không có vấn đề gì','both'],
      没关系:['Không sao','daily_life'],还没有:['Vẫn chưa','both'],
      你看一下:['Bạn xem qua giúp','work'],
      帮我看一下:['Xem giúp tôi','work'],
      处理一下:['Xử lý giúp một chút','work'],
      等一会儿:['Chờ thêm một chút','both']
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
      check:['Kiểm tra','work'],transfer:['Chuyển khoản, chuyển','work'],
      contact:['Liên hệ','both'],ticket:['Phiếu yêu cầu','work'],
      verify:['Xác minh','work'],receive:['Nhận','both'],
      send:['Gửi','both'],request:['Yêu cầu','work'],status:['Trạng thái','work'],
      balance:['Số dư','work'],amount:['Số tiền','work'],
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
