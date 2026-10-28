# Translation context V1 — manual QA before deployment

Status: draft PR only. V1 remains the default translation path. The second V2 button
and multi-model quality pipeline are **not implemented in this change**.

## Manual semantic regression scenarios

Assess preservation of meaning units, not exact string equality. A natural
alternative is fine if actions, conditions, subjects and certainty are unchanged.
The examples below are **human-authored expectations**, not live API results.

| Source | Expected meaning (Vietnamese) | Critical distinction |
| --- | --- | --- |
| 审核的时候发现还有会员能投注体育的说下 | Lúc duyệt, ai phát hiện vẫn còn hội viên đặt cược thể thao được thì báo một tiếng nhé. | Must retain final request 说下 |
| 有异常的说下 | Nếu thấy có bất thường thì báo một tiếng. | Request, not an anomaly report |
| 这笔提现还没审核，先不要出款 | Khoản rút tiền này chưa được duyệt, tạm thời chưa chi/xử lý xuất tiền. | Negation, ordering |
| 会员不能投注体育 | Hội viên không thể đặt cược thể thao. | 能 vs 不能 |
| 这笔出款先别处理，等风控确认 | Khoản chi/xuất tiền này tạm đừng xử lý, chờ xác nhận từ bộ phận kiểm soát rủi ro. | Delay/hold, not already rejected |
| 中奖之后多久到账？ | Trúng thưởng xong thì bao lâu tiền mới về? | Question about payout time |
| 先停一下活动，有问题及时反馈 | Tạm dừng chương trình trước; có vấn đề thì phản hồi ngay. | Two actions |
| 金额确认了再通知我 | Xác nhận số tiền rồi hãy báo tôi. | Condition and sequence |
| 我先去吃饭，回来再说 | Tôi đi ăn trước, lát về nói tiếp. | Everyday context, not gaming |
| 你这人也太会开玩笑了 | Ông đúng là biết đùa thật đấy. | Friend teasing, no formal corporate tone |
| 明天一起去看电影吗？ | Mai đi xem phim cùng nhau không? | Invitation, not an order |
| 这个 bug 只在 staging 复现 | Bug này chỉ tái hiện trên môi trường staging. | Technical environment |
| API 返回 500，先看看日志 | API trả lỗi 500, xem log trước. | Preserve error code/action |
| 确认一下 callback 有没有重复触发 | Kiểm tra xem callback có bị kích hoạt lặp lại không. | Technical terminology |
| Chắc lỗi này do cache. | 这个问题可能是缓存引起的。 | Preserve uncertainty (可能) |
| Anh xem giúp em lỗi API này được không? | 可以帮我看一下这个 API 的问题吗？ | Polite request; no invented obligations |

## Regression workflow
1. Run these cases on Web FREE and Web PRO using NEW uncached results after the key revision.
2. Verify PRO FAST maintains TRANSLATION only. Confirm PRO full retains its requested BACK_TRANSLATION and VOCABULARY fields.
3. Verify web English FREE/PRO and screenshot Chinese chats preserve instructions and terminology, not just keywords.
4. Check Telegram vocabulary output remains separate, copy/speech controls unchanged, and website shares new cache keys.
5. Record the source, output, model/provider, pass/fail and failure type per case. Do not enter real account IDs, passwords, transaction details or private employer chat in public issue logs.
6. Do not merge merely because the Node test suite is green; collect real translation quality results and review failures.

Note: DeepL fallback is a translation endpoint without a user-supplied LLM prompt.
Shared LLM instructions cannot force DeepL to interpret slang the same way.
