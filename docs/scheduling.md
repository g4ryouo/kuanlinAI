# 定時提醒的排程方案

寬林要的推播時間：**平日 07:00、週六日 10:00 早晨簡報**、10:00 抵達確認、16:00 完工確認、20:00 明日預覽與待處理。
所有排程都是呼叫同一類網址（`/api/cron/remind?kind=<種類>`），並帶 `Authorization: Bearer <CRON_SECRET>`；
推播有 `reminders.dedupe_key` 去重，**同一天同一個人只會收到一次**，所以同時開兩種排程也不會重複。

時區：台北 = UTC+8（沒有夏令時間）。排程設定一律用 UTC：

| 台北時間 | UTC（cron 寫法） |
|---|---|
| 07:00 | `0 23 * * 0-4`（UTC 週日至週四，即台北週一至週五） |
| 週六日 10:00 | `0 2 * * 6,0` |
| 10:00 | `0 2 * * *` |
| 16:00 | `0 8 * * *` |
| 20:00 | `0 12 * * *` |

## 目前的安排

| 台北時間 | 提醒 | 排程方式 | 網址 |
|---|---|---|---|
| 06:00 | 請假表同步 | Vercel 內建 | `/api/cron/sync-leaves` |
| **平日 07:00** | 早晨簡報 | **Vercel 內建**（免費，實際落在 07:00–07:59） | `/api/cron/remind?kind=morning` |
| **週六日 10:00** | 早晨簡報 | **Supabase pg_cron** | `/api/cron/remind?kind=morning` |
| 10:00 | 抵達確認 | **Supabase pg_cron**（準點） | `/api/cron/remind?kind=arrive` |
| 16:00 | 完工確認 | **Supabase pg_cron** | `/api/cron/remind?kind=done` |
| 20:00 | 明日預覽與待處理 | **Supabase pg_cron** | `/api/cron/remind?kind=evening` |

**只傳給冠璋**：收件人預設是資料庫裡老闆（`people.role = 'owner'`）的 `line_user_id`；也可以用環境變數 `BRIEF_USER_IDS` 指定（逗號分隔）。兩者都沒有就不推播。

安靜規則（沒有內容就不吵人）：

**假日規則**：週末與國定假日只送早晨簡報（週六日在 10:00 送），10:00 抵達、16:00 完工一律不送；**例外：禮拜日 20:00 照送週一的明日預覽**（`?force=1` 可手動強制）。
- 早晨簡報：週末與國定假日，沒有排班也沒有急件、逾期、等太久的事就不送
- 10:00 抵達確認：今天沒有排班就不送
- 16:00 完工確認：今天沒有排班、也沒有要決定的機動待辦就不送
- 20:00 明日預覽：明天是週末或國定假日，且沒有排班、請假、未排人的工作、要緊的事，就不送

## 設定 Supabase 排程（10:00、16:00、20:00，一次做完）

1. Supabase → Database → Extensions，啟用 **pg_cron** 與 **pg_net**。
2. 在 SQL Editor 先把 `CRON_SECRET` 存進 Vault（把引號裡換成真正的值；`CRON_SECRET` 就是 Vercel 環境變數裡那一個）：
   ```sql
   select vault.create_secret('這裡貼 CRON_SECRET', 'cron_secret');
   ```
3. 一次建立四個排程（第四個是週六日 10:00 的早晨簡報）：
   ```sql
   select cron.schedule('remind-arrive', '0 2 * * *', $$
     select net.http_get(
       url := 'https://kuanlinai.vercel.app/api/cron/remind?kind=arrive',
       headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'))
     );
   $$);

   select cron.schedule('remind-done', '0 8 * * *', $$
     select net.http_get(
       url := 'https://kuanlinai.vercel.app/api/cron/remind?kind=done',
       headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'))
     );
   $$);

   select cron.schedule('remind-morning-weekend', '0 2 * * 6,0', $$
     select net.http_get(
       url := 'https://kuanlinai.vercel.app/api/cron/remind?kind=morning',
       headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'))
     );
   $$);

   select cron.schedule('remind-evening', '0 12 * * *', $$
     select net.http_get(
       url := 'https://kuanlinai.vercel.app/api/cron/remind?kind=evening',
       headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'))
     );
   $$);
   ```
4. 查看、停用、查執行結果：
   ```sql
   select jobid, jobname, schedule, active from cron.job;
   select cron.unschedule('remind-arrive');
   select jobname, status, return_message, start_time from cron.job_run_details order by start_time desc limit 10;
   ```

## 手動測試（需要 CRON_SECRET）
- 只看內容不推播：`/api/cron/remind?kind=evening&dry=1`
- 沒內容也送：加 `&force=1`；今天已經推過還要再送：加 `&resend=1`
- 或在 LINE 傳「今日簡報」立刻看早晨簡報（不推播、不佔去重額度）

## 所有方案比較（給之後調整用）

| 方案 | 準點 | 能做四個時間 | 費用 | 備註 |
|---|---|---|---|---|
| A. Vercel 內建 | 差最多 1 小時 | 只能做每天一次 | 免費 | 目前用在早晨簡報 |
| B. Supabase pg_cron | 準點到分鐘 | 可以 | 免費 | 目前用在其餘三個 |
| C. GitHub Actions | 常延遲 5–30 分鐘 | 可以 | 免費 | 不建議 |
| D. 外部排程（cron-job.org） | 準點 | 可以 | 免費 | 多一個要保管密碼的帳號 |
| E. 升級 Vercel Pro | 準點 | 可以 | 約每月 20 美元 | 最省事 |

## LINE 推播則數
每天最多 4 則、只傳給冠璋 = 每月最多約 120 則（假日沒內容時不送，實際會少一些）。
請在 LINE Official Account Manager 確認 @236tstml 與測試帳號的方案每月可推播幾則（規格書第 4.5 節的待確認項目）。
