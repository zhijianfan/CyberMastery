# ImplementationPlan_ContractFirstParallel_v2.md

## 1. Objective

This revision incorporates the architecture review feedback.

The implementation strategy is optimized for:

-   dependency correctness
-   maximum safe parallelism
-   stable ownership boundaries
-   contract-first development
-   minimal integration bottlenecks

The previous plan optimized for many parallel teams but missed several
foundational dependencies:

-   Workspace/Layout platform
-   Permission ownership
-   Repository migration audit
-   ADR decision freeze
-   Client cache layer
-   Layout editor
-   Application streaming placeholder

This revision fixes those issues.

------------------------------------------------------------------------

# 2. Core Development Model

The project should be executed as:

    Architecture Decisions

            ↓

    Contracts

            ↓

    Platform Services

            ↓

    Functionality Modules

            ↓

    Integration

The main rule:

    No feature owns infrastructure.

    No UI owns domain state.

    No subsystem bypasses contracts.

------------------------------------------------------------------------

# 3. Phase 0 --- Architecture Freeze

This phase is mandatory before parallel development.

## 3.1 ADR Decision Freeze

Create architecture decision records:

### ADR-001 Workspace Identity

Define:

-   self-host identity
-   cloud identity
-   anonymous/local mode

------------------------------------------------------------------------

### ADR-002 Layout Resolution

Freeze:

    (user, style, device)

resolution rules.

Define:

-   device class
-   device ID
-   fallback precedence

------------------------------------------------------------------------

### ADR-003 Environment vs Style

Separate:

Environment:

    workspace capability preset
    feature availability

Style:

    visual/layout preference

------------------------------------------------------------------------

### ADR-004 Artifact Ownership

Define:

    Domain creates artifact

    Artifact service owns lifecycle

    Client caches locally

------------------------------------------------------------------------

### ADR-005 Event Transport

Decision:

Reuse existing event transport if possible.

Only create new workspace event transport if required.

------------------------------------------------------------------------

### ADR-006 Permission Model

Define:

    read
    write
    execute

Ownership:

Permission platform owns:

-   policy evaluation
-   capability grants
-   validation

Other systems only integrate.

------------------------------------------------------------------------

### ADR-007 Plugin Trust Model

Define:

-   built-in
-   trusted
-   sandboxed
-   external

------------------------------------------------------------------------

# 4. Phase 0.2 --- Repository Audit

Before implementation:

Inventory existing work:

Already available:

-   steer/queue chat
-   workspace switcher
-   TUI extraction
-   existing SDK patterns

Produce:

    implementation-status.md

containing:

-   existing implementation
-   migration required
-   obsolete code
-   ownership changes

------------------------------------------------------------------------

# 5. Contract Layer

After ADR freeze, create stable contracts.

## Schema Contracts

Define:

    Workspace
    Layout
    Block
    FunctionalityManifest
    FunctionalityInstance
    Operation
    Event
    Artifact
    ContextCapsule

------------------------------------------------------------------------

## Protocol Contracts

Create:

    workspace.*
    functionality.*
    operation.*
    artifact.*
    context.*

------------------------------------------------------------------------

## SDK Contracts

Generate:

-   server client
-   frontend bindings
-   TUI bindings

------------------------------------------------------------------------

# 6. Parallel Platform Tracks

After contracts, development becomes parallel.

------------------------------------------------------------------------

# Track W --- Workspace/Layout Platform (MVP Critical)

The missing foundational track.

## Backend

Implement:

-   workspace CRUD
-   layout tables
-   layout service
-   revision handling
-   layout.get()
-   layout.save()
-   tuple resolution
-   default layout factory

------------------------------------------------------------------------

## Frontend

Implement:

-   workspace hydration
-   workspace provider
-   workspace switcher migration
-   remove client-authoritative workspace storage

------------------------------------------------------------------------

## Deliverables

    Workspace
        |
        +-- Layout
        |
        +-- Directories
        |
        +-- Plugins

------------------------------------------------------------------------

# Track A --- Functionality Runtime Platform

Responsibilities:

    Registry

    Manifest

    Instance Service

    Gateway

Does NOT own:

-   permissions
-   domain data

Integrates with permission platform.

------------------------------------------------------------------------

# Track B --- Canvas Runtime Platform

Build against workspace API.

Responsibilities:

## Canvas

-   panel
-   blocks
-   renderer loading

## Layout Editor

Must include:

-   editing mode
-   palette
-   drag
-   resize
-   snap
-   collision handling
-   save conflict UI

------------------------------------------------------------------------

# Track C --- Operation Platform

Independent.

Build:

    OperationRecord

    Scheduler

    Effect Fiber

    Cancellation

    Recovery

Supports:

-   chat
-   MCP
-   image processing
-   future streaming

------------------------------------------------------------------------

# Track D --- Event Platform

First evaluate existing event mechanisms.

If insufficient:

Implement:

    Event Store

    Cursor

    SSE/WebSocket transport

    Projection reducer

Requirements:

-   ordering
-   reconnect
-   idempotency

------------------------------------------------------------------------

# Track E --- Permission Platform (MVP Critical)

Single authority for permissions.

Owns:

    Policy

    Capability Grant

    Validation

    Audit

Other systems call:

    permission.check()

They do not implement access control.

------------------------------------------------------------------------

# Track F --- Context Platform

Build:

    Context Broker

    Context Capsule

    Artifact References

Responsibilities:

-   compact context
-   permission filtering
-   budget control

------------------------------------------------------------------------

# Track G --- Artifact Platform

Owns:

    Artifact metadata

    Payload storage

    Lifecycle

Does NOT own:

-   permission rules

Uses Track E.

------------------------------------------------------------------------

# Track H --- Client Cache Platform

Separate from IndexedDB Organizer.

Purpose:

Offline read-only behavior.

Stores:

    layout cache

    projection cache

    revision cursor

    thumbnail cache

Does not store:

-   authoritative workspace data
-   server domain state

------------------------------------------------------------------------

# Track I --- IndexedDB Organizer (Post-MVP Track)

Independent product.

Build:

    Dexie

    Revision System

    Chunk Storage

    Search

    Sync

Does not block web server MVP.

------------------------------------------------------------------------

# 7. Feature Modules

After platform contracts stabilize.

------------------------------------------------------------------------

# Chat Functionality

Depends on:

-   Workspace
-   Functionality Runtime
-   Operation Platform
-   Permission Platform
-   Context Platform

Produces:

    builtin:chat

Features:

-   steer
-   queue
-   cancellation
-   context attachment

------------------------------------------------------------------------

# MCP Search Functionality

Depends on:

-   Functionality Runtime
-   Operation Platform
-   Permission Platform
-   Artifact Platform
-   Context Platform

Produces:

    builtin:online-search

------------------------------------------------------------------------

# Screenshot Browser

Depends on:

-   Artifact Platform
-   Permission Platform
-   Context Platform

Produces:

    builtin:screenshot-browser

------------------------------------------------------------------------

# Application Window Streaming Placeholder

Low-cost Phase 2 feature.

Only implement:

-   manifest
-   permissions
-   renderer
-   unavailable state
-   future adapter interface

No streaming backend.

Produces:

    builtin:application-window-stream

------------------------------------------------------------------------

# Remove From MVP

## File Viewer

Move to post-MVP.

Reason:

-   overlaps organizer scope
-   increases dependency surface
-   not required by v1 functionality set

------------------------------------------------------------------------

# 8. Revised Critical Path

The actual MVP dependency chain:

    ADR Freeze

            ↓

    Contracts

            ↓

    Workspace/Layout Platform

            ↓

    Functionality Runtime

            ↓

    Permission Platform

            ↓

    Canvas Runtime + Layout Editor

            ↓

    Chat Functionality

            ↓

    MVP

------------------------------------------------------------------------

# 9. Parallel Execution Layout

                             Contracts

                                  |

            +---------------------+---------------------+

            |                     |                     |

     Workspace              Runtime Platform       Client Platform

            |                     |                     |

     Layout              Functionality             Canvas

            |              Operation               Cache

            |              Event

            |              Permission

            |              Context

            |              Artifact


                                  |

                         Feature Modules


              Chat        MCP        Screenshot


                                  |

                               Release

------------------------------------------------------------------------

# 10. Repository Strategy

Do NOT use long-lived dependency branches.

Use:

    trunk-based development

Model:

    main

     |
     +-- short-lived feature branch

     |
     PR

     |
     CI

     |
     merge

------------------------------------------------------------------------

## Merge Gates

CI validates:

### Layout Purity

    layout contains only:
    id
    functionality
    transform

------------------------------------------------------------------------

### Dependency Boundaries

Prevent:

-   renderer importing backend repositories
-   domains writing other domains' tables

------------------------------------------------------------------------

### Event Rules

Validate:

-   payload limits
-   cursor behavior
-   idempotency

------------------------------------------------------------------------

### Permission Rules

Validate:

-   all execute paths checked
-   all writes checked

------------------------------------------------------------------------

# 11. Agent Allocation

Recommended:

    Architecture              1

    Contracts                 3

    Workspace/Layout           3

    Runtime Platform           5

    Client Platform            3

    Feature Modules            4

    Storage                    2

    QA/Security                2

Effective parallel workers:

\~23 work packages

Not 23 guaranteed developers.

------------------------------------------------------------------------

# 12. Realistic Speed Expectation

Avoid assuming linear scaling.

Expected:

  Team Model                     Speed
  ------------------------- ----------
  Single developer                  1x
  Small team                  1.5-2.5x
  Well coordinated agents         2-5x

The bottleneck is:

-   integration
-   review
-   contracts
-   testing

not coding.

------------------------------------------------------------------------

# 13. Final Execution Principle

The final architecture execution model:

    Contracts define boundaries.

    Platforms provide capabilities.

    Features consume platforms.

    Artifacts carry large data.

    Context carries compact knowledge.

    Permissions own authority.

    UI renders projections.

    Server owns truth.

This version is the recommended implementation plan.
