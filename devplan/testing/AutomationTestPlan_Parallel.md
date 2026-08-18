# AutomationTestPlan_Parallel.md

## 1. Goal

This test plan is optimized for parallel development of the custom
OpenCode web server.

The testing architecture follows the same principle as implementation:

    Independent modules

            ↓

    Contract validation

            ↓

    Parallel verification

            ↓

    Integration confidence

Each subsystem owns its automated tests and exposes conformance tests
for other teams.

------------------------------------------------------------------------

# 2. Parallel Test Architecture

                             Test Coordinator

                                    |

            +-----------------------+-----------------------+

            |                       |                       |

     Contract Tests          Platform Tests          Feature Tests

            |                       |                       |

     Schema/API             Workspace              Chat

     SDK                    Runtime                MCP

     Events                 Permission             Screenshot

     Boundaries             Artifact               IndexedDB

                             Canvas                 TUI

------------------------------------------------------------------------

# 3. CI Execution Model

Use parallel CI jobs:

    Job 1  Static Analysis
    Job 2  Contract Tests
    Job 3  Backend Unit Tests
    Job 4  Frontend Unit Tests
    Job 5  Platform Integration
    Job 6  Feature Integration
    Job 7  Browser E2E
    Job 8  Security
    Job 9  Performance

Only final integration gates block merge.

------------------------------------------------------------------------

# 4. Phase 0 --- Test Infrastructure

Parallel tasks:

## T0.1 Test Framework Agent

Create:

-   unit test configuration
-   integration environment
-   browser test environment

------------------------------------------------------------------------

## T0.2 Fixture Agent

Create reusable fixtures:

    workspace fixture

    layout fixture

    functionality fixture

    operation fixture

    artifact fixture

    permission fixture

------------------------------------------------------------------------

## T0.3 Mock Service Agent

Create:

    Mock LLM

    Mock MCP server

    Mock Artifact store

    Mock Event server

    Mock SDK

Purpose:

Allow teams to test without waiting for real implementations.

------------------------------------------------------------------------

# 5. Contract Test Track

Independent and always running.

## Schema Tests

Verify:

-   serialization
-   migrations
-   version compatibility
-   invalid input rejection

------------------------------------------------------------------------

## Layout Purity Tests

Enforce:

Allowed:

    id
    functionality
    transform

Forbidden:

    session state
    messages
    credentials
    files
    artifacts

------------------------------------------------------------------------

## SDK Contract Tests

Verify:

-   generated SDK correctness
-   endpoint compatibility
-   client/server version handling

------------------------------------------------------------------------

## Boundary Tests

Prevent:

-   UI importing backend repositories
-   domains modifying other domains' tables
-   artifacts bypassing permission checks

------------------------------------------------------------------------

# 6. Workspace/Layout Test Track

Runs independently.

## Workspace Tests

Verify:

-   create
-   rename
-   delete
-   duplicate
-   activate

------------------------------------------------------------------------

## Layout Tests

Verify:

-   layout save/load
-   revision increment
-   stale update rejection
-   default layout generation

------------------------------------------------------------------------

## Multi-device Tests

Verify:

    desktop layout

    !=

    mobile layout

------------------------------------------------------------------------

# 7. Functionality Runtime Test Track

Independent.

## Registry Tests

Verify:

-   manifest validation
-   duplicate ID rejection
-   plugin enable/disable

------------------------------------------------------------------------

## Instance Tests

Verify:

-   configuration storage
-   revision conflicts
-   archive behavior

------------------------------------------------------------------------

## Runtime Host Tests

Verify:

-   renderer loading
-   lifecycle suspend/resume
-   missing functionality handling
-   error isolation

------------------------------------------------------------------------

# 8. Permission Platform Test Track

Critical path.

## Permission Matrix

Test:

    read only

    write only

    execute only

    administrator

------------------------------------------------------------------------

## Enforcement Tests

Every operation:

    query

    command

    execute

    cancel

    artifact access

    context access

must check permissions.

------------------------------------------------------------------------

## Security Tests

Verify:

-   expired grants rejected
-   revoked grants rejected
-   forged grants rejected
-   cross-workspace access rejected

------------------------------------------------------------------------

# 9. Operation/Event Platform Test Track

## Operation Tests

Verify:

    created
    queued
    running
    cancelled
    completed
    failed

------------------------------------------------------------------------

## Cancellation Tests

Verify:

-   queued cancellation
-   running cancellation
-   cancellation race
-   restart recovery

------------------------------------------------------------------------

## Event Tests

Verify:

-   ordering
-   cursor progression
-   replay correctness
-   duplicate event handling

------------------------------------------------------------------------

# 10. Canvas Test Track

Frontend parallel tests.

## Rendering

Verify:

-   block rendering
-   lazy loading
-   error boundaries
-   permission states

------------------------------------------------------------------------

## Layout Editor

Verify:

-   edit mode
-   palette
-   drag
-   resize
-   snapping
-   collision handling
-   save conflicts

------------------------------------------------------------------------

## Performance

Measure:

-   12 block rendering
-   FPS
-   memory usage
-   suspended blocks

------------------------------------------------------------------------

# 11. Feature Test Tracks

## Chat Track

Verify:

-   steer behavior
-   queue behavior
-   pending inputs
-   cancellation races
-   context attachment

------------------------------------------------------------------------

## MCP Search Track

Verify:

-   provider selection
-   search execution
-   cancellation
-   malformed tool output
-   credential isolation

------------------------------------------------------------------------

## Screenshot Track

Verify:

-   thumbnail loading
-   virtualization
-   artifact access
-   chat attachment

------------------------------------------------------------------------

## Application Stream Placeholder Track

Verify:

-   block renders
-   unavailable state
-   no fake streaming behavior
-   future interface stability

------------------------------------------------------------------------

# 12. Storage Test Tracks

## Client Cache Track

Verify:

-   layout cache
-   projection cache
-   revision validation
-   offline read-only behavior

------------------------------------------------------------------------

## IndexedDB Organizer Track

Independent.

Verify:

-   chunk storage
-   revisions
-   import recovery
-   search rebuild
-   synchronization

------------------------------------------------------------------------

# 13. Security Parallel Track

Runs against all modules.

Tests:

-   dependency scanning
-   secret scanning
-   API fuzzing
-   permission bypass attempts
-   malformed input handling

------------------------------------------------------------------------

# 14. Performance Parallel Track

## Backend

Measure:

-   API latency
-   event throughput
-   operation scheduling delay

------------------------------------------------------------------------

## Frontend

Measure:

-   canvas rendering
-   block lifecycle
-   memory pressure

------------------------------------------------------------------------

## Storage

Measure:

-   import speed
-   hashing speed
-   sync bandwidth
-   cache efficiency

------------------------------------------------------------------------

# 15. Failure Injection Track

Independent chaos tests.

Inject:

-   database restart
-   network loss
-   stale client
-   corrupted artifact
-   interrupted import
-   failed MCP server
-   cancelled operation

Verify:

-   recovery
-   consistency
-   no data loss

------------------------------------------------------------------------

# 16. Agent Workflow Integration

Every implementation task requires:

    Code

    +

    Unit tests

    +

    Contract tests

    +

    Integration fixture

    +

    Documentation update

Agents should run only relevant parallel test suites locally.

------------------------------------------------------------------------

# 17. Merge Gates

A feature merges when:

## Contract Gate

    schemas stable
    API compatible

## Boundary Gate

    ownership rules preserved

## Regression Gate

    existing tests pass

## Security Gate

    permissions verified

------------------------------------------------------------------------

# 18. Recommended Test Ownership

    Contract Team
        owns schema/API tests

    Workspace Team
        owns workspace tests

    Runtime Team
        owns functionality/operation tests

    Frontend Team
        owns canvas/browser tests

    Feature Teams
        own feature tests

    Security Team
        owns adversarial tests

    Performance Team
        owns benchmarks

------------------------------------------------------------------------

# 19. Final Principle

The testing system should mirror the architecture:

    Independent modules

            ↓

    Independent tests

            ↓

    Shared contracts

            ↓

    Continuous integration

Parallel development succeeds only when architectural boundaries are
continuously verified.
