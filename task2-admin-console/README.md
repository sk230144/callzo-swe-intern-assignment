# Task 2: Usage Admin Console

An admin console for viewing and editing account usage, built against the provided
mock API with React, Tailwind and Recharts.

## Run it

Needs Docker and nothing else.

```bash
docker compose up
```

Then open <http://localhost:3000>. The compose file pulls a pre-built frontend image.
On x86 machines the mock API runs under emulation and can take about a minute to
become healthy, so the frontend starts once that's done.

The browser can't resolve `mock-api`, so nginx in the frontend container serves the
app and proxies `/api/*` to `API_URL` (`http://mock-api:8001`).

### Local development and tests

```bash
docker compose up mock-api    # in one terminal
npm install
npm run dev                   # http://localhost:5173
npm test                      # unit tests, using Node's built-in runner
```

### Rebuilding the published image

The reviewer's machine may be either architecture, so publish both:

```bash
docker buildx build --platform linux/amd64,linux/arm64 \
  -t <username>/callzo-task2-frontend:1.0.0 --push .
```

## Where state lives, and why

| State | Lives in | Why |
|---|---|---|
| Page, page size, search, filters, date range, sort | **URL** | Survives refresh, can be shared, and the back button works |
| Open account and current form step | **URL** | Refreshing mid-form returns to the same step |
| Accounts page, chart data | **Server**, with the latest response held in a hook | The server owns it and it changes constantly. Caching it locally would only go stale |
| Saved form drafts | **Server** | The API has a drafts endpoint, so a draft follows the account, not the browser |
| Row selection | **Client memory** | It's a temporary working set, and a list of ids could be too long for a URL |
| Unsaved form edits, chart metric | **Client memory** | Only meaningful for the moment the user is working on them |

*Given up:* selection is lost on a full page reload. Invalid drafts are too, since the
server won't store them.

## What I cut, and why

- **Bulk actions on selected rows.** The brief asks for stable selection, not for
  anything to do with it. The bar shows a count and totals so the selection is visible.
- **Virtualised rows.** Paging is server-side and caps a page at 200 rows.
- **Local backup of invalid drafts.** Valid edits reach the server within a second.
  A half-typed email would be lost on reload, which I judged not worth a second
  source of truth.
- **Warning on tab close.** The autosave window is under a second.
- **Highlighting cells that changed on refresh.** It would add visual noise to a table
  whose values change on every poll.
- **Code-splitting Recharts.** The bundle is about 185 kB gzipped, which is fine for an
  internal tool.
- **Dark mode**, and component or browser tests in the repo: the brief limits
  libraries to React, Tailwind and a chart library. Unit tests cover the pure logic.

Vite and its React and Tailwind plugins are build tools and aren't in the shipped
bundle. URL state, polling, form state and the modal are hand-written on React and
the platform (`<dialog>`, `fetch`, History API). There is no router or data library.

## Decisions and trade-offs

### Refreshing without jumping

The table and chart refresh every 15 seconds, pausing while the tab is hidden. A
refresh updates values in place: rows keep their positions, keys and focus, even when
sorted by a column that just changed. If the server's order has shifted, a "Re-sort"
button appears instead of the rows moving under the cursor.

*Given up:* while sorted by a changing column, the order can be slightly out of date
until the user asks for it.

### The chart that fails 1 in 5 times

`/accounts/summary` is retried once, quietly, on a 5xx, which turns most failures
into a short delay. If the retry also fails:

- On first load or after a filter change, the chart shows an inline error with a Retry
  button. The table isn't affected, because each view loads independently.
- On a background refresh, the previous chart stays up with a note saying how old it is.

To see the error state reliably, run `docker stop mock-api`. Both views show it, and
they recover on their own after `docker start mock-api`.

### Long date ranges

The API returns one point per day, which is unreadable over three years. The chart
groups into weeks past 62 days and months past 366, and says which it's showing.
Every value is also available under "View as table".

### Autosave and failed saves

Edits save 800 ms after typing stops, one request at a time per step, always sending
the latest values. Invalid values aren't sent.

"Roll back" here means the record of what's saved rolls back, not the user's typing.
Each step tracks `values` (on screen) and `saved` (last accepted by the server). A
failed save leaves `saved` untouched, so nothing is reported as saved when it wasn't.
Wiping what someone just typed because of a network blip would be hostile, so the text
stays, with **Try again** and **Discard my changes**, which restores the saved values.

### The step 2 and step 4 behaviour

Once step 4 has a draft, the server rejects step 2 saves with "billing_country is
required", even with a valid value. What the UI does:

- The error appears on the billing country field in step 2, and the step is flagged
  in the stepper. From any other step, a banner links back to it.
- A callout explains the rule, since the field visibly has a value.
- Other steps' data is untouched. Step 4 can still be edited and saved.
- **The user can't get stuck:** an unchanged step isn't re-sent, so moving through step
  2 without editing never triggers the error. If they did edit it, discarding restores
  the saved values, and Submit then succeeds using them.
- Submit refuses to go ahead over a step with unsaved changes. Otherwise it would
  silently finalise values different from the ones on screen.

Forward navigation needs earlier steps to be saved. Without that, someone could reach
step 4 first, after which step 2 could never be saved and Submit could never succeed.
Going back is always allowed.

The one case the UI can't resolve is a draft created outside this UI, with step 4
saved and step 2 missing. Only a server change could fix that.

### Keyboard and small screens

Everything is native controls, operable by keyboard. Focus moves to the step heading
on a step change and to the first invalid field on a failed step. The native modal
traps focus, Escape closes it (saving first), and focus returns to the row's Edit
button. Disabled pagination uses `aria-disabled`, so reaching the last page doesn't
drop focus.

At 375px there's no horizontal scroll. Secondary columns fold into the account cell,
sort controls replace the column headers, and the form goes full screen.

## Assumptions

1. The date filter applies to `signup_date`, as the spec says, for both the table and
   the chart, even though the chart shows usage over time.
2. The country filter lists the 10 countries in the mock data, as the API has no
   endpoint listing them.
3. Billing country is prefilled from the account only if it's one of the 5 allowed.
4. Negative caps are rejected in the form, although the mock API would accept them.

## With more time

1. Bulk actions on the selection, such as CSV export.
2. Browser tests covering the form flows, run in CI.
3. An endpoint for distinct filter values, replacing the fixed country list.
4. Dark mode, with its own validated chart colour.
