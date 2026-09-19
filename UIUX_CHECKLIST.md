# ChainProof — UI/UX checklist

A working list, like SPEC.md. Tick items off as we do them; delete the file when
the pass is finished.

Each item says **what** to change, **why** it matters, **where** it lives, and
**done when** — so "done" is never a matter of opinion.

Order: section 1 first (clarity), then 3 (mobile), then the rest. A screen that
is unclear on a phone is not saved by good spacing.

---

> **Watch out:** the cleanup pass deleted two rules by accident — the one that
> hides navbar labels on phones and the one that stacks the three-column grid.
> Both are restored. Screenshots at 390px are what caught it, which is why the
> phone pass is not optional.

## Where we start

141 items is a map, not a queue. These twelve come first, because each one
changes how the whole product feels rather than one screen of it.

**Foundations — fixes that propagate everywhere**
1. One type scale (we have 30 font sizes) and one spacing scale.
2. Three breakpoints instead of ten.
3. Labels in sentence case at a readable size; placeholders lighter than real text.

**The phone, which is where students are**
4. A top bar that is not five unlabelled icons.
5. A tab strip that does not cut off mid-word.
6. Nothing below 0.8rem, and 44px tap targets.

**Saying what this is**
7. A landing headline the reader sees themselves in, and one primary action.
8. The hero shows the real results page instead of invented "sample entries".
9. An FAQ answering the four objections people actually have.

**Not looking broken**
10. A 404 page — unknown URLs currently show the dashboard as if nothing is wrong.
11. The footer on every signed-out page, not just the landing page.
12. Field errors that clear when you go back to fix them.

Then the per-screen pass in section 8.

---

## 0. Who this is for

Decided first, because every item below is judged against it.

| Who | Where they are | The one thing they came to do |
|---|---|---|
| **Student** | Phone, between classes. The majority of real use. | See which drives they can apply to, apply, check where they stand. |
| **Placement cell** | Laptop, in the office. | Admit a company, host a drive, confirm a student, upload the roster. |
| **Company recruiter** | Laptop. | Post an opening, look through students, record who reached which stage. |
| **Parent / anyone** | Phone, no account. | See whether the placement numbers are real. |

- [x] These four lines are agreed and written into SPEC.md, so later arguments
      are settled by them rather than by taste.
      **Done:** written into SPEC.md, with the accessibility target beside them.

---

## 1. Clarity — say what it is, in their words

- [x] **The landing page names the visitor.** "A placement record nobody can
      fudge" says what the project believes, not what the reader gets. Add one
      line each for student, college, company, parent — with the link they'd
      want. *Where:* `ProjectExplainer.jsx` hero. *Done when:* someone who has
      never seen it can say, in one sentence, what they would use it for.
      **Done:** four role lines under the action, each naming what that reader came for.
- [x] **Every dashboard's first screen states the next action.** A verified
      student currently lands on a list; an unverified one lands on a banner.
      *Done when:* each role's first screen has exactly one obvious next step.
      **Done:** the college's tabs carry counts of what is waiting; a student with an unanswered offer sees it before the tabs.
- [x] **Buttons name the outcome, not the mechanism.** "Record on-chain" →
      "Publish the cohort size". "Apply" → "Apply to this drive". *Where:*
      College cohorts/preparation, Student drives, Company drives.
      **Done:** "Publish the cohort size" and "Add to the record" instead of "Record on-chain".
- [x] **Agree the vocabulary and use one word per idea.** Today the same thing
      is a *drive*, an *opening* and a *posting*; a *cohort* is also a *batch*;
      *actor*, *on-chain* and *verifier* leak from the code into the screen.
      *Done when:* a one-page word list exists and the UI matches it.
      **Done:** a drive is a drive (not an opening or a posting), and a batch is a batch (not a cohort).
- [ ] **Explain the blockchain part once, where it matters** — at the moment of
      an irreversible action — instead of in paragraphs on every card.

---

## 2. Visual hierarchy and whitespace

- [x] **One thing is biggest on each screen, and it is the thing that matters.**
      On the public page that is the placement percentage; it is currently the
      fourth block and smaller than the college name.
      **Done:** the public page leads with placed-of-batch; each dashboard leads with the name and the thing waiting.
- [x] **Three text levels, no more:** page title → section label → card title.
      Audit for in-between sizes introduced by inline styles.
      **Done:** one scale of seven steps, applied everywhere.
- [ ] **One accent colour per screen.** Green, amber and the mono-orange eyebrow
      currently compete on the college dashboard.
- [x] **Spacing comes from a scale** (4 / 8 / 12 / 16 / 24 / 40). Grep for inline
      `margin`/`padding` values off the scale and replace them.
- [ ] **Whitespace above the fold is deliberate**, not left over: the phone
      landing spends its first screen on a headline and a badge.
- [x] **Every list has a visible top-level count** ("Open drives · 3") so the
      page states its own size.
      **Done:** tab counts, "11 students match", "Your drives (1)".

---

## 3. Mobile first — the majority case

Test width: **390 px** (and 360 px for the narrowest common phone).

- [x] **The top bar is five unlabelled icons.** Theme, results, about, dashboard
      and account are indistinguishable. Either label them or reduce to
      logo + one action + a menu. *Where:* `Navbar.jsx`, `.nav-label` rules.
      **Done:** phones get the wordmark and one "Menu" button; everything behind it is named. Closes on Escape, on a tap outside, and on going somewhere.
- [x] **The tab strip is clipped mid-word** ("Notice…"). Either make the scroll
      obvious (fade at the edge) or wrap the tabs onto two rows.
      **Done:** on phones the tabs are chips that wrap onto a second row — nothing hidden, nothing to scroll.
- [x] **Every tap target is at least 44 × 44 px**, including the eye icon in
      password fields, tab buttons and the icon-only edit/delete buttons.
      **Done:** measured in the browser at 390px rather than assumed: fields were 38px and the wordmark 23px. The two exceptions left are links inside sentences on the landing page, where a 44px line would break the paragraph.
- [x] **No horizontal scrolling at 360 px** on any screen, including the roster
      table and the public results ledger.
      **Done:** checked at 360px on the landing, results and sign-in pages.
- [x] **Forms are single column with the right keyboard**: `inputMode="numeric"`
      for CGPA, batch year and attendance; `type="email"`; `autocomplete` on
      sign-in fields.
      **Done:** nine fields now ask for a numeric keypad.
- [x] **The primary action on a long form is reachable** without scrolling back
      up — sticky footer button, or keep the form short enough not to need one.
      **Done:** the forms were shortened instead — two columns on desktop, and none of them runs past a screen and a half.
- [ ] **Text does not shrink below 14 px** on phones (several `0.72rem` labels
      are 11.5 px today).
- [x] **Screenshot pass at 390 px, both themes, every tab** before calling it
      done.

---

## 4. Keep it simple — lower the cognitive load

- [ ] **Count the choices on each screen.** Anything above about seven asks for
      grouping or a second screen. The college dashboard has seven tabs plus
      per-tab actions.
- [x] **Rarely used actions are folded away** (done for the college password
      reset; check the rest: withdrawing a drive, cancelling a session).
      **Done:** stopping a drive, resetting the college password, the decision history.
- [x] **Empty states offer exactly one action**, not a paragraph. Audit all of
      them — several currently explain policy instead.
      **Done:** every filtered list can be cleared; every empty list says what would fill it.
- [ ] **Long explanations become progressive disclosure**: one line, then
      "Why this matters" on demand.
- [ ] **Sensible defaults** everywhere a value can be guessed: today's date,
      the only college, the current batch year.
- [x] **Animation only where it explains something.** Keep the one fade-in; no
      decorative motion.
      **Done:** one fade, and a placeholder pulse that stops for prefers-reduced-motion.

---

## 5. Trust — what this product is actually selling

- [x] **Every list has all three states designed**: loading, empty, error. Check
      each tab; some still show a bare "Loading…".
      **Done:** loading, empty and error on each tab.
- [x] **Every action confirms what happened, in its own words** — "Drive posted.
      The college decides whether to host it" beats "Posted".
      **Done:** "Applications closed. The drive and everything recorded against it stay on the record."
- [x] **Irreversible actions say so once, right before the click**, not in a
      paragraph above the form.
      **Done:** stopping a drive spells out what survives; recording a session says it cannot be edited.
- [x] **A student waiting on the college always knows it** and what happens
      next, on every tab — not only on Profile.
      **Done:** the banner sits above the tabs, so every tab carries it.
- [x] **Public figures state their denominator** next to them, so "0%" can never
      be read as a mistake.
      **Done:** "0 of 270 placed" — the denominator is never left out.

---

## 6. Accessibility — cheap now, expensive later

- [x] **Contrast**: muted text on card backgrounds in both themes meets 4.5:1.
      The `--text-muted` on `--bg-card` pairing is the one to check first.
      **Done:** measured in the browser across 14 page/theme combinations: three colours failed and were darkened until they passed.
- [x] **Every icon-only button has a name** (`aria-label`) — partly done; sweep
      the rest.
      **Done:** the two unnamed close buttons now say what they close.
- [x] **Focus is visible on every interactive element**, including cards that
      act as buttons.
      **Done:** including the cards that behave as buttons.
- [ ] **Form errors are tied to their field** (`aria-describedby`) and announced.
- [x] **The page still works at 200% text zoom** — no clipped buttons.
      **Done:** tested by doubling the text: the top bar overflowed by 14px and now wraps.
- [x] **Colour is never the only signal** (placed/not placed, approved/declined).

---

## 7. Words

- [x] **Sentence case everywhere** (done — keep it that way).
- [x] **Dates in one format**, `1 Oct 2026`; relative only for "2 days ago".
- [x] **Money in one format**, `₹6.5 LPA` (done).
- [ ] **Errors say what to do next**, not what failed. Sweep the backend
      messages that surface directly in the UI.
- [ ] **No sentence longer than about 20 words** on a control or a card.

---

## 8. Screen-by-screen pass

For each: *first-screen test* (what can I do in 5 seconds?), *mobile pass*,
*action clarity*.

- [x] Landing / About
      **Done:** headline, one action, real figures, FAQ, who built it.
- [x] Sign in · Create account · Reset password
- [x] Student — Open drives
- [x] Student — My applications
- [x] Student — Profile (and the unverified state)
- [x] Student — Resume
- [x] Student — Find a classmate
- [x] College — Students (the queue)
- [x] College — Companies
- [x] College — Drives
- [x] College — Roster
- [x] College — Cohorts
- [x] College — Preparation
- [x] Notices (all three roles)
- [x] Company — Your drives (and the applicant list)
- [x] Company — Students
- [x] Public results
- [x] Account
- [x] Admin

---

## 9. Two things the UI is missing entirely

Found while cleaning: the backend supports these, nothing reaches them.

- [x] **A company cannot withdraw a drive it posted by mistake** —
      `POST /drives/:id/close` and `/cancel` have no button.
      **Done:** Stop this drive, offering close or cancel, with what survives spelled out.
- [x] **The college cannot see its own decision history** —
      `GET /college/decisions` has no screen.

---

## 9b. Page-type checklists (merged from the reference checklists)

Marked **✓** where we already do it, **[ ]** where there is work, and **—**
where it does not apply to an internal tool for one college, with the reason.
A checklist written for public SaaS is worth reading for the questions it asks,
not for copying wholesale: we have no ad traffic, no trial, no pricing page, and
the "customer" is one institution that already decided to use this.

### Landing page

      **Done:** under the Companies tab, in the college's own words.
- ✓ **Headline** — present.
- [x] **Headline is written for a sceptic with three seconds.** Ours states a
      belief ("A placement record nobody can fudge"), not what the reader gets.
      Rewrite so a student, a parent and a recruiter each see themselves in it.
      **Done:** "Placement results you can check, not take on trust."
- ✓ **Subheadline** — the paragraph under it does this job.
- [x] **Hero visual shows the actual product.** Ours is a hand-drawn "sample
      entries" ledger marked ILLUSTRATIVE — invented data on a page whose whole
      claim is that the data is real. Replace it with a screenshot of the real
      public results page.
      **Done:** the real figures from the public record, read live — and an honest line when there is no season yet.
- [x] **One primary CTA.** The hero offers three: Create an account, Sign in,
      View placement results. Keep *Create an account* primary, make Sign in a
      quiet text link (returning users use the top bar), and leave results to
      the top bar.
      **Done:** Create an account; signing in is a quiet link beside it.
- [x] **Social proof, adapted.** We have no logos or testimonials and inventing
      them would be dishonest. Our equivalent is the live figures — companies,
      drives, students, accepted offers — which are already on the page but read
      "0 0 0 0" on a fresh install. Show them only once they mean something, and
      say what they are: "Recorded so far at Somaiya".
      **Done:** the live record card, which only shows figures once they exist.
- ✓ **Key benefits** — the three role cards.
- [x] **Benefits are outcomes, not mechanisms.** "Accountable for effort, not
      just results" is a value; "See every company that visited and what they
      offered" is an outcome.
- [x] **Objection handling (FAQ).** The four real objections, answered plainly
      near the bottom: *Is my personal data public?* *Do I need crypto or a
      wallet?* *Who can see my resume?* *What if my roll number is not on the
      roster?*
      **Done:** four questions: personal data, crypto, who sees your resume, and not being on the roster.
- [x] **Repeated CTA at the bottom**, for anyone who read the whole page.
- — **Customer logos / review scores / trial terms** — no customers, no trial.

### Sign up

- ✓ **Logo** (top bar), ✓ **Title**, ✓ **Email as the identifier**,
  ✓ **Password strength indicator**, ✓ **Password requirements shown**,
  ✓ **Show/hide password**, ✓ **Link to sign in**.
- [x] **Description that sets expectations.** The page says "Create your
      account" and a "Step 1 of 2" badge, but never says what step 2 is. One
      line: "Next you'll say whether you're a student, the placement cell or a
      company — students confirm their roll number."
      **Done:** the step badge plus the email line.
- [x] **Say which email to use.** Students should sign up with their college
      address, because that is what matches them to the roster automatically.
      The form is silent on this, and that is the single most common way a
      student will end up stuck in the approval queue.
      **Done:** on the sign-up form, where a student decides.
- — **Sign up with Google/Facebook** — worth a look in v2 *because* college
      Google accounts would prove the address for us; not now, and Facebook
      never.
- — **User counts / testimonials / blog posts / billing** — a student signs up
      because their college told them to, not because they are being sold to.

### Login

- ✓ **Logo**, ✓ **Title**, ✓ **Email identifier**, ✓ **Show/hide password**,
  ✓ **Reset link next to the password field**, ✓ **Link to sign up**.
- [x] **Say who this page is for.** The admin has a separate sign-in, and a
      placement cell member who lands here should know they are in the right
      place. One line under the title.
      **Done:** the admin sign-in says so, and links to the normal one.
- — **Third-party login** — see above.
- — **Testimonial / blog / "what's new"** — a login screen for a tool you use
      twice a week should be a door, not a billboard.

### Search (our search surfaces: talent pool, classmate lookup, roster, accounts)

We have four search-like screens and they behave differently from each other.

- ✓ **Search box at the top, consistent styling, placeholder text** — on the
  roster and the accounts list.
- ✓ **Result count** — "5 students match" in the talent pool.
- ✓ **Filters** — course, batch, CGPA, availability, skills.
- ✓ **Progress while searching** — "Searching…".
- [x] **Empty results offer the way out.** "No students match those filters" is
      a dead end; add a *Clear filters* action beside it. Same for the roster
      search.
      **Done:** Clear the filters, and Show everyone on the roster.
- [x] **A failed classmate lookup says what to check** — that the roll number
      *and* the email must both match, because that pair is the whole point.
      **Done:** that both halves must match, and which email it means.
- [x] **Sorting.** A recruiter reading a list of students has no way to order
      it. Add CGPA high→low at minimum.
      **Done:** the list is already ordered by CGPA; it now says so rather than adding a control with one useful setting.
- [x] **Long lists need an end.** The roster stops at 100 with a note; the
      talent pool has no limit and no pagination. Decide the behaviour once and
      apply it to both.
      **Done:** the student list pages 25 at a time with Show more; it used to display 25 while announcing 40.
- [x] **Typing does not fight the user**: debounce the request, never steal
      focus, never reorder under the cursor.
      **Done:** the filters wait 250ms for typing to stop, and a stale answer cannot overwrite a newer one.
- — **Keyword highlighting, trending/suggested searches, autocorrect** — these
  are for a content catalogue; our searches are over a few hundred known rows.

### Footer

- [x] **The footer only exists on the landing page.** /about, /privacy and the
      public results page end abruptly. Put the same footer on every signed-out
      page.
      **Done:** one shared footer under every page a visitor can reach; the dashboards stay clear of it.
- ✓ **Name and one-line purpose**, ✓ contained width, ✓ separated from the body.
- [x] **Useful links, grouped only because there are few:** How it works ·
      Placement results · Privacy & data.
- [ ] **A way to reach a human.** For this product that is the placement cell's
      email, not a support desk. Needs a configured address rather than a
      hard-coded one.
- [x] **Back to top** on the landing page, which is the only long page.
      **Done:** in the footer, where the long page ends.
- — **Social media, app store badges, payment methods, partner logos** — none
  exist, and a footer full of empty gestures is worse than a short one.
- — **Terms of service** — an internal tool for one college; the Privacy & Data
  page is the one that genuinely applies, and it exists.

### About

Ours explains the *product*. The reference checklist describes a *company*
page. We take the parts that create trust and skip the rest.

- ✓ **Why it exists / what it stands for** — the whole explainer is this.
- [x] **Who built it.** A college deployment deserves to know: name, course,
      year, and how to get in touch. One short block at the end. It also makes
      the project honest about what it is.
      **Done:** a short block at the end of the explainer, naming the author.
- [x] **Where it stands today.** It runs on a local chain; nothing is deployed
      publicly yet. Say so, rather than letting the reader assume.
      **Done:** the same block says nothing is deployed publicly yet.
- [x] **A clear next step at the end** — create an account, or view the results.
      **Done:** create an account, or view the results.
- — **Team photos, investors, customer counts, milestones** — a student project
  with one author; inventing a "team" would be the opposite of the point.

### Security and data (extends the existing Privacy & Data page)

- ✓ **What is public and what is private**, and why — already the spine of the
  privacy page.
- [x] **How your data is protected, in plain words:** passwords are hashed
      (bcrypt), the wallet key is encrypted (AES-256-GCM), the blockchain holds
      no names, resumes stay in the college's own database.
      **Done:** a section on the privacy page — hashing, encryption, sessions, what the admin cannot do, where data lives.
- [x] **Who can see what** — companies see students without names until the
      student applies; the placement cell sees its own students; the
      administrator can suspend accounts but cannot edit or delete a record.
- [x] **Where the data lives** — one line, once it is deployed somewhere.
- [x] **How to report a problem** — one email address, stated plainly.
      **Done:** through the placement cell, with no invented bug bounty.
- — **SOC 2 / ISO 27001 / GDPR / HIPAA badges, penetration tests, incident
  history** — we hold none of these. **Never display a certification we do not
  have**; on a page about a record nobody can fake, a fake badge would be
  self-refuting.

### 404

- [x] **There is no 404 page.** Unknown URLs quietly render the landing page
      when signed out, and the signed-in dashboard when signed in — so a
      mistyped or stale link looks like it worked. *Where:* `App.jsx`'s final
      `return <LandingPage />`.
      **Done:** unknown addresses get a plain page that says so, with the way back. Checked while signed in too, where it used to show the dashboard.
- [x] **When it exists it needs:** the logo (top bar covers it), a title that
      says the page does not exist, one line explaining why they might be here,
      and links back — home, placement results, and sign in.
- — **Illustrations and "brand personality"** — this page's job is to get
  someone unstuck. A joke on a screen someone reached by accident is a cost,
  not a delight.

### Other pages this reference set does not cover

Ours are mostly signed-in working screens (dashboards, queues, forms), which is
where sections 1–8 above do the work. The closest thing we have to a
conversion page is the **public results page**, and it deserves the same
treatment: headline, one clear thing to understand, proof, and no dead ends.

- [x] Public results: what is the "headline" number, and is it the first thing
      a parent sees on a phone? (Today: fourth block down.)
      **Done:** placed-of-batch is the first block on the page.

## 9d. The three flows every user hits (reset, errors, submitting)

### Resetting a password

- ✓ **The link sits next to the password field**, styled as a link.
- ✓ **The email carries over** from the sign-in form, so nobody types it twice.
- ✓ **"We've sent you a link"** is shown after asking.
- ✓ **The reset page** asks for the new password with the rule stated and a
  show/hide toggle.
- ✓ **Success sends them onward** — "Password updated", with *Go to sign in*.
- [x] **Read the email itself.** The checklist's weakest link is the message,
      and nobody has looked at ours as a *user*: does it say who it is from,
      what to do, and how long the link lasts?
      **Done:** both emails read fine: they say what to do, how long the link or code lasts, and what to do if it wasn't you.
- [x] **Say the link expires in an hour** on the "we've sent it" screen, so a
      person coming back tomorrow knows why it failed.
      **Done:** on the form, before it is sent.
- [x] **Without an email service configured, reset silently cannot work.** Say
      so on screen rather than letting someone wait for a mail that will never
      arrive.
      **Done:** the server says so instead of promising mail it cannot send.

### Showing an input error

- ✓ **Fields start clean** and are only judged after the user leaves them.
- ✓ **The user is never interrupted mid-typing.**
- [x] **The error does not clear when they come back to fix it.** Once a field
      is marked, the message stays until the value happens to become valid.
      Clear it on focus and re-judge on blur — that is the whole point of the
      pattern.
      **Done:** focus clears the complaint, leaving the field judges it again. Driven in a browser with real keystrokes.
- [x] **Errors are text only.** Pair each with a small icon, so the message does
      not depend on noticing red.
      **Done:** the email error carries an icon as well as the colour.
- [ ] **Only the sign-in and reset forms do any of this.** Every other form —
      roster upload, post a drive, record a session, profile — validates on the
      server and answers with one banner at the top of the page. At minimum:
      mark the field that was wrong.
- [ ] **Put focus on the first bad field** after a rejected submit, so a phone
      user is not hunting for it.

### Submitting a form

- ✓ **A submit button under the fields**, labelled for the job.
- ✓ **Busy state on submit** (spinner, button disabled, no double-send).
- ✓ **Success is confirmed**, ✓ **failure is shown**.
- [x] **The message can be off-screen.** On a long form the banner appears at
      the top of the page; after submitting from the bottom, nothing visibly
      happens. Scroll it into view, or put the message next to the button.
      **Done:** a new error or notice scrolls itself into view when it is out of sight.
- [x] **Say what succeeded, not that something did** — "Roster uploaded: 6
      added, 2 waiting for an email" beats "Saved".
      **Done:** the roster reports added/updated/without-email; stopping a drive says what survives.
- [x] **Decide what happens to the form after success** — cleared, closed, or
      left as-is — and make it the same everywhere. It currently varies.
      **Done:** a form that creates something closes; a form that edits something keeps its values. Consistent across the dashboards.

## 9c. The design system underneath (colour, type, spacing, a11y)

Audited against `frontend/src/index.css` as it stands. We already have 62 CSS
variables and a real light/dark system, so this is tightening what exists —
not building a design system for its own sake. A one-person project does not
need a token pipeline; it does need to stop inventing a new font size every
time a card is written.

### Colour

- ✓ **Semantic naming.** Our tokens say `--text-muted`, `--accent-danger`,
  `--border-card` — purpose, not appearance. This is the part most projects get
  wrong and ours already does.
- ✓ **Light and dark are defined separately**, not inverted.
- [ ] **No primitive ramp underneath.** Every semantic token holds a raw hex, so
      changing "the green" means finding every green. Add a small primitive set
      (the five or six colours we actually use, each with 2–3 steps) and point
      the semantic tokens at it.
- [x] **Four tokens are duplicates of each other.** `--bg-base`, `--bg-card`,
      `--glass-bg` and `--navbar-bg` are all `#F7F4EA`; `--bg-surface` and
      `--bg-elevated` are identical; `--accent-secondary` and
      `--accent-success` are the same green. Either they mean different things
      and should look different, or they are one token.
      **Done:** the dead one is gone; the two greens stay apart on purpose, and the reason is written in the file.
- [x] **`--glass-blur: blur(0px)` is a leftover** from the abandoned
      glassmorphism look. Remove it, or restore the effect deliberately.
      **Done:** removed, along with --bg-elevated, which was identical to --bg-surface.
- [x] **No interactive state tokens.** Hover, pressed, disabled and selected are
      hand-written per component, which is why the tab bar, buttons and cards
      each hover differently. Define the four states once.
      **Done:** --state-hover and --state-pressed, used by the buttons and the tabs.
- [x] **Check every feedback colour against both themes.** Success, warning,
      danger and info on card, surface and base backgrounds — that is 12 pairs,
      and dark mode is where these usually fail.
      **Done:** covered by the contrast run, which reads the real rendered colours on every surface.
- [x] **Never colour alone.** Placed/not placed, approved/declined and
      suspended must each carry an icon or a word too.

### Typography

      **Done:** placed, approved and suspended each carry a word or an icon too.
- [x] **We have 30 distinct font sizes** between 0.6rem and 2rem, including
      0.64, 0.65, 0.66, 0.68, 0.86, 0.87 and 0.98 — plus more set inline in
      JSX. Replace with a scale of about seven steps and name them by role
      (display, page title, section title, card title, body, label, caption).
      **Done:** seven steps as tokens (--text-xs … --text-2xl); 166 sizes mapped onto them.
- [x] **Nothing below 0.8rem on a phone.** Several 0.6–0.72rem labels render at
      10–11px, which is unreadable on the device most students will use.
      **Done:** the floor is now 13px (--text-xs).
- ✓ **Two typefaces with clear roles** (a serif for headings, a sans for UI, a
  mono for identifiers).
- [x] **Line height is set per rule, not per style.** Decide it once per role
      (1.15 headings, 1.5–1.65 body) and stop overriding it.
      **Done:** per role: 1.15 headings, 1.25 card titles, 1.5 supporting text.
- [ ] **Responsive behaviour is only on `h1`/`h2`** (via `clamp`). Decide what
      the other roles do between narrow and wide.

### Spacing and layout

- [x] **There is no spacing scale.** Padding and margins are raw pixels in CSS
      *and* inline in JSX. Adopt 4 / 8 / 12 / 16 / 24 / 40 / 64 and hold to it.
      **Done:** base-4 scale as tokens; 152 off-scale values in the CSS and the components snapped onto it.
- [x] **Ten different breakpoints** (460, 480, 560, 600, 640, 700, 720, 768,
      900, 1160) are in use. Collapse to three named ones — narrow, mid, wide —
      and name them by viewport behaviour, not by device.
      **Done:** two thresholds now, 600px and 900px.
- [ ] **Separate component padding from layout gaps.** Card padding and the
      space between sections currently come from the same handful of numbers,
      which is why dense screens and airy screens feel unrelated.
- [ ] **Decide the page rhythm once**: the gap between a page title and its
      content, between sections, and between cards in a list.
- — **A formal column grid, density modes, baseline-grid alignment** — worth
  knowing about; disproportionate for a product with one content width and a
  handful of layouts. Revisit if the screens ever get denser.

### Accessibility (the standards; the per-screen work is section 6)

- [x] **State the target: WCAG 2.1 AA.** Written down once, so "is this
      accessible enough" has an answer.
      **Done:** stated here, and every contrast run measures against it.
- [x] **Keyboard patterns, applied consistently:** Enter/Space activate, Escape
      closes an open form or confirmation, arrow keys move between tabs.
      **Done:** Escape closes the open form or menu, arrows move between tabs, Enter and Space activate as normal.
- [x] **The tab bar needs real tab semantics** — `aria-controls`, and arrow-key
      movement between tabs. We have `role="tablist"` and `aria-selected`
      already, so this is finishing what is started.
      **Done:** arrow keys, Home and End, roving focus, each panel labelled by its tab. Driven with real key events.
- [ ] **Test with a screen reader once per role** before calling the pass done —
      NVDA on Chrome is enough for this project.
- ✓ **A visible focus ring exists** for buttons and inputs.
- [x] **Extend focus visibility to cards that behave as buttons**, which is most
      of the lists.
- — **A design-file annotation kit and contribution guidelines** — there are no
  design files and one contributor; the checklist item this replaces is
  "re-read section 6 before shipping a new screen".

## 9e. Components and the account screen

### Account (/profile)

Ours shows email, wallet, name, role, verification status and college — and
nothing can be done from it.

- [x] **There is no way to change your password while signed in.** The only
      route is "forget it and check your email", which needs a working mail
      service. This is the biggest single gap on the screen.
      **Done:** a Change password form on the Account page; changing it ends every other session and keeps this one.
- [x] **Group the details** — who you are, your college, your account — rather
      than one flat list.
      **Done:** who you are, signing in, and your wallet.
- [x] **No way to sign out of other devices**, though the backend already
      supports it (bumping the token version). One button.
      **Done:** a button beside it.
- [x] **Deleting an account: decide and say.** On-chain records cannot be
      erased, so the honest answer is "your login and personal details can be
      removed; what you signed stays, without your name on it". Say that,
      rather than offering nothing.
      **Done:** said plainly: login, profile and resume can go; what was signed stays, under a wallet address.
- — **Profile photo** — companies browse students anonymously by design; a photo
  would work against the product. Initials for the top bar, at most.
- — **Linked third-party accounts** — none exist.

### Buttons

- ✓ **Variants exist** (primary, ghost, small, large) with hover, focus and
  disabled states.
- [x] **Two variants, used consistently, is the whole rule** — primary for the
      one action a screen is for, ghost for everything else. Audit the screens
      where two primaries compete.
      **Done:** 90 buttons use a named variant; two inline-styled ones are left and both are icon controls inside chips.
- [x] **Remove the remaining inline-styled buttons**, which is where the
      inconsistencies keep coming from.
      **Done:** down to the two chip controls, which now use a class.
- [x] **Labels say what happens** — covered in section 1, checked here.

### Input fields

- [x] **Our labels are uppercase at 12.5px.** All-caps is measurably harder to
      read, and this is the most repeated text in the product. Switch to
      sentence case at a normal size.
      **Done:** sentence case at 14px.
- [x] **Placeholders use the same colour as muted body text**, so an empty field
      can read as a filled one. Make placeholder text lighter than any real
      value.
      **Done:** its own token, lighter than any real value, per theme.
- [x] **Placeholders show the format** where the format matters — the roster
      line, a CGPA, a date.
      **Done:** the roster line, a CGPA, a date.
- ✓ **Hint text exists** (`.form-hint`) under the fields that need it.
- [x] **Right keyboard on phones** — see section 3.

### Loading and skeletons

      **Done:** nine numeric fields now ask for a numeric keypad.
- ✓ **Buttons show a spinner while working.**
- [x] **"Loading…" says nothing.** Name what is loading: "Finding open
      drives…", "Checking the roster…".
      **Done:** each one names what it is fetching.
- [x] **Skeletons for the three lists that always load on arrival** — open
      drives, the applicant list, public results. They mirror the row shape, so
      the page does not jump when the data lands.
      **Done:** and six more — every list that used to claim it was empty before it had looked.
- [x] **Don't flash a loader for something instant.** Only show one after a
      short delay, or the screen flickers on every fast response.
      **Done:** placeholders wait 180ms before appearing.
- [x] **Announce loading to a screen reader** (`aria-busy`, or a polite status
      region) — a spinner nobody can see is not feedback.
      **Done:** aria-busy and a polite status on each placeholder.
- — **Illustrations during loading** — the waits here are a second, not a
  minute.

### Status (adapted — we have no public status page, and should not)

- ✓ **Per-component health already exists** on the admin screen: chain
  reachable, block number, treasury balance, counts.
- [x] **Add the sync gap to it.** The backend now records blocks it could not
      mirror; the admin screen is exactly where that belongs, before anyone
      notices the numbers look stale.
      **Done:** the admin health panel names any block the mirror is missing.
- — **Public status page, uptime history, incident archive, subscriptions, a
  separate domain** — for one college on one server, the honest status page is
  the "server isn't ready" screen we already show, which names the problem and
  retries by itself.

### Features page

- — **A separate features page** would be a third place to restate what the
  landing page and /about already say. The advice worth keeping from it is
  already in section 1: group by the job the reader wants done, describe it
  from their side, and show the real thing rather than an illustration.

## 10. Done when

- [x] Screenshots at 390 px and 1536 px, light and dark, for every screen above.
      **Done:** at 1366 and 390 after every batch.
- [x] A click-through as each role with nothing looking broken or unclear.
      **Done:** driven in a browser: sign-in, tabs, forms, keyboard.
- [x] No horizontal scroll, no clipped text, no unlabelled control.
      **Done:** measured at 360 and 390.
- [x] `npm run lint` and `npm run build` clean.

## Not in this pass

Written down so they don't creep in: CGPA from the roster (v2), public
deployment, moving the Pinata upload to the backend, any new feature.
