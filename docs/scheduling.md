# 定時提醒的排程方案

寬林要的推播時間：**07:30 早晨簡報**、10:00 抵達確認、16:00 完工確認、20:00 明日預覽與待處理。
所有排程都是呼叫同一類網址（`/api/cron/<名稱>`），並帶 `Authorization: Bearer <CRON_SECRET>`；
推播有 `reminders.dedupe_key` 去重，**同一天同一個人只會收到一次**，所以同時開兩種排程也不會重複。

時區：台北 = UTC+8（沒有夏令時間）。排程設定一律用 UTC：

| 台北時間 | UTC（cron 寫法） |
|---|---|
| 07:30 | `30 23 * * *`（前一天 23:30） |
| 10:00 | `0 2 * * *` |
| 16:00 | `0 8 * * *` |
| 20:00 | `0 12 * * *` |

## 方案 A：Vercel Cron（目前採用，只有早晨簡報）
- 設定在 `vercel.json` 的 `crons`，不用另外開任何服務。
- **免費方案限制**：每天最多執行 1 次，而且只保證「在那個小時內」執行，07:30 實際可能落在 07:00–07:59。
- 只能做每天一次的提醒（早晨簡報）；10:00、16:00、20:00 做不到。

## 方案 B：Supabase pg_cron + pg_net（推薦：免費、準點到分鐘、可做全部四個時間）
你們已經有 Supabase，不用新增廠商。

1. Supabase → Database → Extensions，啟用 **pg_cron** 與 **pg_net**。
2. 在 SQL Editor 先把 `CRON_SECRET` 存進 Vault（把引號裡換成真正的值）：
   ```sql
   select vault.create_secret('這裡貼 CRON_SECRET', 'cron_secret');
   ```
3. 建立排程（先建早晨簡報這一條）：
   ```sql
   select cron.schedule('morning-brief', '30 23 * * *', $$
     select net.http_get(
       url := 'https://kuanlinai.vercel.app/api/cron/morning',
       headers := jsonb_build_object(
         'Authorization',
         'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
       )
     );
   $$);
   ```
4. 查看與停用：
   ```sql
   select jobid, jobname, schedule, active from cron.job;
   select cron.unschedule('morning-brief');
   ```
5. 啟用方案 B 後，可以把 `vercel.json` 裡的 `/api/cron/morning` 排程拿掉（留著也不會重複推播）。

## 方案 C：GitHub Actions 排程
- 免費，但 GitHub 的排程常延遲 5–30 分鐘，而且長期沒有 commit 的專案會被停用排程。不建議做準點提醒。

## 方案 D：外部排程服務（例如 cron-job.org）
- 免費、可以設到分鐘、可帶自訂標頭。缺點是多一個要保管密碼的第三方帳號。

## 方案 E：升級 Vercel Pro
- 每月約 20 美元，Cron 可到每分鐘、數量不限。最省事，但要付費。

## LINE 推播則數
每天推一次、兩位收件人 = 每月約 60 則；四個提醒時間 × 兩人 = 每月約 240 則。
請在 LINE Official Account Manager 確認 @236tstml 與測試帳號的方案每月可推播幾則（規格書第 4.5 節的待確認項目）。
