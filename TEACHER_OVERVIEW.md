# ChainProof — A Simple Explanation

## 1. What is ChainProof?

ChainProof is a placement website for a single college. Students, the college and recruiting companies each use it for their own part of the placement season. Parents, and anyone else, can look at the results without an account.

What makes it different: every placement figure is written down by the one party that has no reason to exaggerate it, and once written it can never be changed.

## 2. The problem it solves

When a college says "92% of our students were placed", there is usually no way to check it:

- **Who counted?** The college reports its own results.
- **92% of what?** If the batch size quietly shrinks from 180 to 60, the same number of placements looks far better.
- **Does an offer count?** An offer that was withdrawn, or that the student turned down, is sometimes still counted.
- **Can it be changed later?** Records kept in spreadsheets can be edited after the fact.

ChainProof answers each of these by deciding *who is allowed to write each fact*, and by keeping every fact permanently.

## 3. The core idea

Imagine a register where anyone can add a line, but nobody — not even the person who wrote it — can erase or change an old line. If something changes, a new line is added and the old one stays visible beside it.

That is what the blockchain is used for here. It is simply a shared register with one unusual rule: entries are permanent.

The second idea matters just as much: **each fact is written by whoever would be embarrassed by a lie.**

| Fact | Who writes it | Why that stops cheating |
|---|---|---|
| A job offer | The company | The college cannot invent offers for its own students |
| Accepting an offer | The student | A company cannot claim it hired someone who said no |
| The batch size | The college | It is public, and every change stays visible |
| Training sessions held | The college | They are recorded as they happen and cannot be added later |

## 4. Who uses it

- **Students** — sign up, confirm they study at the college using their roll number, build a resume, apply to drives, and accept or decline their own offers. They can also look up a classmate, if they know both the classmate's roll number and email address.
- **The college (placement cell)** — uploads the list of its students, declares how many students are in each batch, decides which companies may recruit on campus, agrees to host each drive, records training and mock interviews, and posts placement notices.
- **Companies** — sign up and, once the college approves them, post drives with their own terms (role, salary, CGPA cutoff). They browse the college's students anonymously, and record how each applicant progressed.
- **The administrator** (the project owner) — creates the college's account and can suspend or restore an account if something goes wrong. The administrator **cannot** create or change any placement record.
- **The public** — sees each batch's results, the companies that came, and the college's preparation record. No student is ever named.

## 5. How a placement season works, step by step

1. The administrator creates the college's account.
2. The college uploads its student list and declares the batch size — for example, "CSE 2026: 180 students".
3. A student signs up with an email and password, then enters their roll number. If it is on the college's list they are confirmed straight away. If not, the placement cell checks it by hand. Until then, the student can look around but cannot apply.
4. A company signs up and waits for the college to approve it.
5. The company posts a drive, and the college agrees to host it.
6. Before visiting, the company can browse the college's students by course, CGPA and skills. It sees their resumes, but **not their names or contact details**.
7. Eligible students apply. A student below the CGPA cutoff is told exactly why they can't. Applying is what gives the company that student's contact details.
8. The company records each applicant's progress: shortlisted, interviewed, offered, or not selected.
9. The student accepts or declines their offer. **Only an accepted offer counts as a placement.** If the company later withdraws it, the student stops counting as placed.
10. Throughout, the college records its training sessions and mock interviews.
11. The public dashboard updates automatically from all of this.

## 6. What makes it trustworthy

- **Nothing is edited or deleted.** A withdrawn offer, a changed batch size and a cancelled training session are each added as a new entry, and the original stays visible.
- **Nobody can write another party's facts.** This is enforced by the blockchain itself, not just by the website.
- **Even the administrator can't change results.** The administrator can only suspend or restore accounts, and every such action is recorded.
- **The percentage is honest about its denominator.** It is shown against the whole declared batch, with the number of students who signed up shown beside it. If the college changed the batch size, the public page says so.
- **Personal details stay private.** Names, roll numbers and resumes are never written to the blockchain, because anything written there can never be removed. The blockchain only records events, tied to anonymous account codes.

## 7. What it's built on

- **A blockchain** — the permanent register. Four small programs ("smart contracts") on it enforce who may write what.
- **A normal website** — people sign in with an email and password, as on any site. Nobody needs a crypto wallet or any technical knowledge; the website handles the blockchain behind the scenes.
- **A regular database** — holds personal information (names, resumes, contact details), which can be corrected or deleted. It also keeps a quick copy of the blockchain records so pages load fast. The blockchain remains the source of truth for placement records.

## 8. Where it stands today

The whole placement season described above is built and working, and backed by about 390 automated tests plus live end-to-end checks.

It currently runs on a private practice blockchain on a single computer. The next step is to publish it on a public test network (Polygon Amoy), so that anyone can check the records independently of ChainProof itself.
