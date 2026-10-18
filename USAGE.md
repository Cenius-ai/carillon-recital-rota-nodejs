# Using Carillon Recital Rota

Everything below is reachable from the running app with the demo account
`cenius@cenius.ai` / `cenius`.

## Sign in (`/login`)

The sign-in card shows the demo credential and a **Use demo account** button that
fills and submits the real login form. The email field accepts either the email
address or the username (`cenius`). Use **Create an account** to register with a
display name, email and password (8+ characters).

Wrong credentials always answer with the same message — *"Email or password is
incorrect."* — so the form never reveals whether an address exists. After five
minutes of repeated failures the server throttles further attempts and answers
`429`.

## Dashboard (`/`)

- **KPI strip** — open recital dates, your own claims, practice slots in the next
  seven days, and the total number of programme pieces on the rota.
- **Upcoming Sunday recitals** — every date ahead of today, sorted by Sunday, with
  the assigned carillonneur, the programme length, and **Claim** / **Cancel claim**
  buttons. Your own rows are tinted and marked.
- **Your commitments** — the recitals and practice slots you hold, with inline
  cancellation.
- **Tower practice · next 7 days** — claim or release slots without leaving the page.
- **Quick add** — a compact recital form (Sunday date + title) and practice-slot form
  (date, start, end, tower room). Both write immediately; the new record appears in
  the panels above without a reload.

## Sunday recital rota (`/rota`)

The full season in one dense table with filters — *Upcoming*, *Open dates*,
*Claimed by you*, *Past*, *Everything* — each showing a live count. **Open** on a row
opens its programme page. Claiming a date locks it to you; if somebody else claimed
it first the request answers with a plain-language conflict message and the table
refreshes to show who holds it.

**Add recital** (`/rota/new`) takes the Sunday date, the title and optional notes.
The date field previews the chosen day and refuses anything that is not a Sunday —
the server enforces the same rule, so a hand-crafted request cannot slip through.

## Recital detail and programme (`/recitals/:id`)

- **Details** — the Sunday date with a relative label, who is playing, the claim
  status, programme length and total minutes, the notes for the carillonneur, and
  when the recital was added. **Edit details** swaps the panel for a form; **Delete
  recital** asks for confirmation first and removes the recital together with its
  programme.
- **Programme** — pieces in playing order with composer, **arrangement credit** and
  duration. Each row has **Edit** (inline form) and **Remove** (confirmed inline).
  An empty programme invites the first piece.
- **Add a programme piece** — title, composer, arrangement credit (defaults to
  *Original for carillon*), optional duration in minutes and performance notes. New
  pieces are appended to the end of the programme.

## Tower practice board (`/practice`)

Slots are grouped by day, each group headed by the full date and a relative label
(*Today*, *Tomorrow*, *In 3 days*). Every slot shows its time window, tower room,
claim state and notes. Filters switch between *All upcoming*, *Open* and *Claimed by
you*.

- **Claim** takes an open slot; a second claim answers with a conflict message.
- **Cancel** releases your own slot; anybody else's slot cannot be released (`403`).
- **Delete** removes the slot after an inline confirmation.

**Add practice slot** (`/practice/new`) takes a date, start and end time, tower room
and optional notes. The end time must be after the start time — checked in the form
and again on the server.

## Keyboard and accessibility

Tab reaches the skip link first, then the brand, the navigation, the session controls
and the page content. Focus is always visible (2px ring in the accent colour). Forms
submit with <kbd>Enter</kbd>, validation messages sit at their field with
`aria-invalid`, and destructive actions require a second, focused confirmation.
Status messages (claimed, released, added, deleted) are announced through a polite
live region, and errors through an alert region. Layouts collapse to a single column
at 390px with no horizontal scrolling; tables become labelled stacked rows.
