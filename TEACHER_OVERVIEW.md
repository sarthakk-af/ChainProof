# ChainProof — A Simple Explanation

## 1. What is ChainProof?

ChainProof is a website that keeps a permanent, shared record of a college's placement activity — who got hired, by which company, and when — that stays exactly as it was created, for everyone involved to rely on.

## 2. The Problem It Solves

When a college shares its placement numbers, there is usually no independent way to verify them — the underlying activity lives across many separate conversations, spreadsheets, and records that nobody outside the college can easily check. This is not any one party's fault; it is simply how placement tracking has always worked. Students do not have an independent, portable record of their own achievements. Companies do not have an easy way to confirm that a student's claimed interviews or offers actually took place.

What is missing is a neutral, shared record that students, colleges, and companies can all rely on equally.

## 3. The Core Idea, Explained Simply

Imagine a notebook that anyone involved can write a new entry into, but nobody — including the person who wrote it — can ever erase or edit an old entry. If something changes later (say, a job offer gets withdrawn), the only way to reflect that is to write a brand new entry explaining the change. The old entry stays visible forever, right next to the update.

That is what a blockchain is being used for here. It is not a magic word — it is simply a shared record book with one unusual rule: entries are permanent.

Because of that one rule, the placement percentage is always calculated from the same activity everyone can see — it updates automatically as real steps happen, rather than being compiled and reported separately.

## 4. Who Uses It

- **Students** — sign up, get linked to their college, and receive permanent records of things like being shortlisted, interviewed, or receiving an offer.
- **Colleges** — publish which companies are visiting, and issue those permanent records to their own students.
- **Companies** — issue the same kind of records directly (shortlist, interview, offer, rejection) to the students they interact with.
- **An administrator** — confirms that a college or company signing up is genuinely who they say they are before letting them act on the platform.
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

- **Nothing is ever deleted or edited.** Every action — a registration, a credential, a visit announcement — stays visible permanently.
- **Mistakes are corrected openly, as part of the record.** If something needs to change later, it happens by adding a new, clearly linked record. The original stays visible right alongside it, so the full history is always there to see.
- **Placement percentages are calculated automatically**, directly from these records, rather than being compiled and reported by hand.
- **A rejected college or company is not permanently shut out.** If a registration is denied by mistake, they can simply try again — and the earlier attempt still remains part of the honest record either way.

## 7. What It's Built On

Three simple layers work together:

- **A blockchain** — this is where every important action gets permanently recorded. Think of it as the platform's memory, which nobody is able to rewrite.
- **A normal website** — built so that using the platform feels exactly like using any other website. Nobody needs to install anything, understand cryptocurrency, or manage a digital wallet themselves. That complexity is handled invisibly behind the scenes.
- **A small, fast lookup helper** — a lightweight local database that keeps a quick copy of what is already on the blockchain, purely so the website loads quickly. It is not where the real information lives — it is only a convenience layer. The blockchain is always the actual source of truth.

## 8. Where It Stands Today

ChainProof is fully built and working end to end — signing up, registering a role, administrator approval, issuing credentials, publishing visit announcements, and the public dashboard are all functioning and tested. It currently runs on a free, public test version of a real blockchain network, which means every record it creates can be independently verified by anyone, on a public website, entirely separate from ChainProof itself.
