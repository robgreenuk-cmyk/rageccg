# AI_COLLABORATION.md

**Project:** Rage CCG\
**Status:** Active\
**Version:** 1.0

## Purpose

Defines how AI assistants collaborate on the Rage CCG project to
maximise progress while avoiding duplicated work.

## Team Roles

### Project Lead

-   Prioritises work
-   Approves architecture
-   Integrates changes
-   Coordinates communication

### Claude

Primary implementation engineer. - Production code - Refactoring - New
systems - Integration - Build verification

### ChatGPT

Architecture, review and planning. - Architecture review - Debugging -
Documentation - Regression planning - Edge-case analysis

ChatGPT should avoid overlapping production implementation unless
specifically requested.

## Working Principles

1.  Respect ownership.
2.  Avoid duplicate implementation.
3.  Preserve original Rage behaviour wherever practical.
4.  Prefer maintainable solutions.
5.  Keep documentation aligned with implementation.

## Collaboration Workflow

1.  Project Lead defines objectives.
2.  Claude implements.
3.  Claude produces a Status Update.
4.  Project Lead shares results with ChatGPT.
5.  ChatGPT reviews architecture, maintainability and testing
    implications.
6.  Agreed improvements are implemented.
7.  Repeat.

## Standard Status Update

When asked to "Produce a status update for Claude/ChatGPT", use:

-   Current Objective
-   Completed Since Last Report
-   Current Work
-   Files Changed
-   Architectural Decisions
-   Known Risks / Potential Conflicts
-   Suggested Partner Tasks
-   Requested Review
-   Next Implementation Step

## Documentation

Repository documentation is part of the deliverable. Significant
architectural or workflow changes should be reflected in the relevant
documentation.

## Communication Guidelines

-   Be concise and technical.
-   Distinguish facts from proposals.
-   Do not assume unconfirmed changes are in the repository.
-   Raise architectural concerns before major rewrites.

## Success Criteria

-   Complementary rather than duplicated work.
-   Coherent architecture.
-   Current documentation.
-   Faithful implementation of Rage CCG.
