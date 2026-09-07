# ChainProof — A Simple Explanation

## 1. What is ChainProof?

ChainProof is a website that keeps a permanent, honest record of a college's placement activity — who got hired, by which company, and when — in a way that nobody, not even the college itself, can secretly change afterward.

## 2. The Problem It Solves

When a college says "95% of our students got placed," there is usually no way to check if that is true. The college collects and reports the numbers itself, so nothing stops a college from leaving out students who did not get placed, or rounding numbers up, to look better. Students have no independent proof of their own achievements beyond what the college says about them. Companies have no easy way to confirm that a student's claimed interviews or offers actually happened.

There is no neutral, outside record that students, colleges, and companies can all trust equally.

## 3. The Core Idea, Explained Simply

Imagine a notebook that anyone involved can write a new entry into, but nobody — including the person who wrote it — can ever erase or edit an old entry. If something changes later (say, a job offer gets withdrawn), the only way to reflect that is to write a brand new entry explaining the change. The old entry stays visible forever, right next to the update.

That is what a blockchain is being used for here. It is not a magic word — it is simply a shared record book with one unusual rule: entries are permanent.

Because of that one rule, a college cannot quietly inflate its placement numbers, because every step that led to that number is out there permanently, for anyone to check.

## 4. Who Uses It

- **Students** — sign up, get linked to their college, and receive permanent records of things like being shortlisted, interviewed, or receiving an offer.
- **Colleges** — publish which companies are visiting, and issue those permanent records to their own students.
- **Companies** — issue the same kind of records directly (shortlist, interview, offer, rejection) to the students they interact with.
- **An administrator** — checks that a college or company signing up is genuinely real before letting them act on the platform, so nobody can pretend to be a real institution without being verified first.
- **The public** — anyone, without logging in, can visit a public page and see real, verified placement statistics for every college on the platform.

## 5. How It Actually Works, Step by Step

1. Someone signs up with just an email and password — no technical or crypto knowledge needed at all.
2. They choose a role: Student, College, or Company.
3. If they chose College or Company, an administrator checks they are a genuine institution before approving them. Students do not need this check — they only need to indicate which college they belong to.
4. Once approved, a college can announce that a company is coming to visit, and can issue records (such as "shortlisted," "interviewed," or "offer made") directly to a student.
5. A company can do the same — it can view the registered students and issue the same kinds of records as it moves a candidate through its own hiring process.
6. Every one of these records becomes permanent the moment it is created. A student can watch their own history build up over time on their personal dashboard.
7. Behind the scenes, the moment a student receives an "Offer" record, they are automatically counted as placed. Nobody manually updates a placement count.
8. Anyone at all — a parent, a journalist, another student deciding where to apply — can visit the public dashboard with no login and see real placement percentages for every college, calculated directly from these permanent records.

## 6. What Makes It Trustworthy

- **Nothing can be secretly deleted or edited.** Every action — a registration, a credential, a visit announcement — stays visible forever.
- **Mistakes are corrected openly, never hidden.** If something needs to change later, it happens by adding a new, clearly linked record. The original stays visible, so nobody can quietly rewrite history.
- **Placement percentages are calculated automatically**, directly from these records, not typed in by a college. A college cannot report a percentage that does not match its own actual recorded activity.
- **A rejected college or company is not permanently shut out.** If a registration is denied by mistake, they can simply try again — and the earlier rejection still remains part of the honest record either way.

## 7. What It's Built On

Three simple layers work together:

- **A blockchain** — this is where every important action gets permanently recorded. Think of it as the platform's memory, which nobody is able to rewrite.
- **A normal website** — built so that using the platform feels exactly like using any other website. Nobody needs to install anything, understand cryptocurrency, or manage a digital wallet themselves. That complexity is handled invisibly behind the scenes.
- **A small, fast lookup helper** — a lightweight local database that keeps a quick copy of what is already on the blockchain, purely so the website loads quickly. It is not where the real information lives — it is only a convenience layer. The blockchain is always the actual source of truth.

## 8. Where It Stands Today

ChainProof is fully built and working end to end — signing up, registering a role, administrator approval, issuing credentials, publishing visit announcements, and the public dashboard are all functioning and tested. It currently runs on a free, public test version of a real blockchain network, which means every record it creates can be independently verified by anyone, on a public website, entirely separate from ChainProof itself.
