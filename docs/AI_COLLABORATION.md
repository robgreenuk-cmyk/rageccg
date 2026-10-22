# AI_COLLABORATION.md

**Project:** Rage CCG\
**Status:** Active\
**Version:** 2.0

## Purpose

Defines how AI assistants and the Project Lead collaborate on the Rage CCG project to maximise progress while avoiding duplicated work and wasted upload effort.

## Team Roles

### Project Lead

-   Prioritises work
-   Approves architecture
-   **Is the arbiter of rules questions** (checks `docs/ragerules2018.pdf`; do not assume the Project Lead remembers rulings)
-   Integrates changes (uploads files to GitHub by hand, usually from a phone)
-   Coordinates communication

### Claude

Primary implementation engineer.

-   Production code
-   Refactoring
-   New systems
-   Integration
-   Build verification
-   Testing, including randomized stress tests and live checks in a headless browser

### ChatGPT and Gemini

Architecture, review, rules verification and planning.

-   Architecture review
-   Debugging
-   Rules verification
-   Documentation
-   Regression planning
-   Edge-case analysis

They should avoid overlapping production implementation unless specifically requested.

## Working Principles

1.  Respect ownership.
2.  Avoid duplicate implementation.
3.  Preserve original Rage behaviour wherever practical.
4.  Prefer maintainable solutions.
5.  Keep documentation aligned with implementation.

## Standing Working Agreements

These are the Project Lead's standing instructions to the implementing assistant. They apply in every working session.

1.  **Audit the live repository before proposing changes.** Make a fresh clone; never rely on memory or an earlier copy.
2.  **Deliver complete, ready-to-commit files — never diffs or fragments.**
3.  **Run the tests immediately after each change.** Report the real numbers.
4.  **Flag ambiguity rather than extrapolating.** If the rules text or the card text leaves a question open, say so and ask.
5.  **Ask for primary card text** rather than inferring it from truncated data or web searches. (Known source when the repo data is truncated: `https://rageccg.weebly.com/spoilers.html`.)
6.  **Confirm core mechanics before implementing them.**
7.  **Surface bugs transparently** rather than silently fixing them: say what was wrong, why, and what changed.
8.  **On rules questions cite the rules text** (section numbers) rather than leaning on remembered rulings.

## Collaboration Workflow

1.  Project Lead defines objectives.
2.  Claude audits the repository, confirms any open rules questions, then implements.
3.  Claude tests (suite, randomized stress, live browser where the UI changes) and produces a Status Update.
4.  Project Lead uploads the delivered files and confirms.
5.  Claude verifies the upload (see *Delivery protocol*).
6.  Project Lead may share results with ChatGPT or Gemini for architecture or rules review.
7.  Agreed improvements are implemented.
8.  Repeat.

## Delivery Protocol

The Project Lead uploads files manually, so delivery must be exact.

-   Deliver **every changed file in full**, preserving the repository's folder structure (for example a `combat/` subfolder for files that live in `combat/`).
-   State clearly **which files are new, which replace existing ones, and which folder each belongs in.**
-   **Never claim files are in the repository.** Ask the Project Lead to confirm the upload, then **verify with a fresh clone**: compare each file byte-for-byte with what was delivered, confirm no other tracked file changed, and run the suite.
-   Keep replies concise; the Project Lead reads on a phone.

## Standard Status Update

When asked to "Produce a status update for Claude/ChatGPT/Gemini", use:

-   Current Objective
-   Completed Since Last Report
-   Current Work
-   Files Changed
-   Architectural Decisions
-   Known Risks / Potential Conflicts
-   Suggested Partner Tasks
-   Requested Review
-   Next Implementation Step

## Handover Protocol

Long working sessions slow down. At the end of a context window:

1.  Finish and verify the current work (suite green; delivered files verified against a fresh clone).
2.  Bring `ARCHITECTURE.md`, `ROADMAP.md` and `CHANGELOG.md` up to date.
3.  Write or refresh `docs/HANDOVER.md`: the project state, the next task, the decisions still open, the environment notes, and the lessons learned.
4.  Tell the Project Lead which obsolete documents to delete.

A new session begins by reading `HANDOVER.md`, then making a fresh clone and running the tests.

## Documentation

Repository documentation is part of the deliverable. Significant architectural or workflow changes should be reflected in the relevant documentation in the same piece of work.

## Communication Guidelines

-   Be concise and technical.
-   Distinguish facts from proposals.
-   Do not assume unconfirmed changes are in the repository.
-   Raise architectural concerns before major rewrites.
-   Report what was verified and what was not. If something could not be checked, say so.

## Success Criteria

-   Complementary rather than duplicated work.
-   Coherent architecture.
-   Current documentation.
-   Faithful implementation of Rage CCG.
-   Every delivery verified against the live repository.
