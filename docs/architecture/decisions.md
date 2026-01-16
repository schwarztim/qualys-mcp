# Architecture Decision Records

This document captures key architecture decisions made for the Qualys MCP Server, following the ADR (Architecture Decision Record) format.

## ADR Index

| ID | Title | Status | Date |
|----|-------|--------|------|
| ADR-001 | Use MCP Protocol for AI Integration | Accepted | 2025-01 |
| ADR-002 | TypeScript as Implementation Language | Accepted | 2025-01 |
| ADR-003 | STDIO Transport for MCP | Accepted | 2025-01 |
| ADR-004 | Basic Authentication for Qualys API | Accepted | 2025-01 |
| ADR-005 | Client-Side Rate Limiting | Accepted | 2025-01 |
| ADR-006 | XML to JSON Response Conversion | Accepted | 2025-01 |
| ADR-007 | Environment Variables for Configuration | Accepted | 2025-01 |
| ADR-008 | Single File Architecture | Accepted | 2025-01 |

---

## ADR-001: Use MCP Protocol for AI Integration

### Status
Accepted

### Context
We need to provide AI assistants with access to Qualys vulnerability management capabilities. There are several approaches:
1. Direct API integration in AI client
2. Custom protocol between AI and adapter
3. Model Context Protocol (MCP) standard

### Decision
Use the Model Context Protocol (MCP) as the integration protocol between AI assistants and the Qualys adapter.

### Rationale
- **Standardization**: MCP is an emerging standard for AI-tool integration
- **Compatibility**: Works with Claude Desktop and other MCP-compatible clients
- **Structured Tools**: MCP provides a clear tool definition and invocation model
- **Future-proof**: As MCP adoption grows, this server will work with more clients

### Consequences
**Positive:**
- Immediate compatibility with Claude Desktop
- Clear separation between AI and vulnerability management logic
- Well-defined tool schemas and contracts

**Negative:**
- Dependency on MCP SDK (relatively new)
- Limited to MCP-compatible AI clients
- STDIO constraint limits deployment options

### Alternatives Considered
1. **REST API wrapper**: Would require custom AI integration
2. **OpenAI function calling format**: Proprietary, not portable
3. **LangChain tools**: Framework-specific

---

## ADR-002: TypeScript as Implementation Language

### Status
Accepted

### Context
The MCP server needs to be implemented in a language that:
- Has good MCP SDK support
- Is familiar to the development team
- Has strong ecosystem for HTTP and XML processing

### Decision
Use TypeScript with Node.js as the implementation platform.

### Rationale
- **Official SDK**: @modelcontextprotocol/sdk has first-class TypeScript support
- **Type Safety**: TypeScript provides compile-time type checking
- **Ecosystem**: Excellent HTTP (Axios) and XML (xml2js) libraries
- **Deployment**: Easy to run on any platform with Node.js

### Consequences
**Positive:**
- Strong typing for tool definitions and handlers
- Good IDE support and developer experience
- Same-language as many MCP examples

**Negative:**
- Requires Node.js runtime
- JavaScript ecosystem security concerns (dependency sprawl)
- Not as performant as Go or Rust

### Alternatives Considered
1. **Python**: Good SDK support, but type safety concerns
2. **Go**: Performant, but less mature MCP SDK
3. **Rust**: Excellent performance, but no official MCP SDK

---

## ADR-003: STDIO Transport for MCP

### Status
Accepted

### Context
MCP supports multiple transport mechanisms:
- STDIO (Standard Input/Output)
- HTTP with Server-Sent Events
- WebSocket

### Decision
Use STDIO as the transport mechanism for MCP communication.

### Rationale
- **Simplicity**: No network configuration required
- **Security**: No network ports to secure
- **Claude Desktop**: Native support for STDIO MCP servers
- **Process Isolation**: Clear process boundaries

### Consequences
**Positive:**
- Simple deployment (just run the process)
- No firewall or network configuration
- Clear process lifecycle management

**Negative:**
- Cannot be deployed as a network service
- Single client at a time
- No horizontal scaling possible

### Alternatives Considered
1. **HTTP/SSE**: Would allow remote clients but adds complexity
2. **WebSocket**: Good for bidirectional, but overkill for this use case

---

## ADR-004: Basic Authentication for Qualys API

### Status
Accepted

### Context
Qualys API supports multiple authentication methods:
- HTTP Basic Authentication (username/password)
- Session-based authentication
- OAuth 2.0 (limited availability)

### Decision
Use HTTP Basic Authentication with credentials from environment variables.

### Rationale
- **Universality**: Works with all Qualys subscriptions
- **Simplicity**: No token management or refresh logic
- **Qualys Recommendation**: Documented as primary method for API v2.0

### Consequences
**Positive:**
- Simple implementation
- Works immediately with existing Qualys credentials
- No token expiration handling

**Negative:**
- Password must be stored (not just tokens)
- No credential rotation without restart
- Cannot use OAuth security benefits

### Alternatives Considered
1. **Session tokens**: Adds complexity of session management
2. **OAuth 2.0**: Not universally available in Qualys
3. **API keys**: Not supported by Qualys for VM API

---

## ADR-005: Client-Side Rate Limiting

### Status
Accepted

### Context
Qualys API has rate limits that, if exceeded, result in 429 errors and potential account suspension. We need to prevent exceeding these limits.

### Decision
Implement client-side rate limiting with a 1-second delay between requests.

### Rationale
- **Proactive Protection**: Prevents hitting Qualys limits
- **Simple Implementation**: Just a delay between requests
- **Predictable Behavior**: Users know requests will be throttled

### Consequences
**Positive:**
- Prevents 429 errors from Qualys
- Protects Qualys account from abuse
- Simple to understand and implement

**Negative:**
- May be overly conservative for some subscriptions
- No adaptation to actual Qualys limits
- Sequential requests only (no parallel)

### Alternatives Considered
1. **No rate limiting**: Risk of 429 errors
2. **Token bucket**: More complex, allows bursts
3. **Adaptive limiting**: Respect Qualys rate headers (more complex)

---

## ADR-006: XML to JSON Response Conversion

### Status
Accepted

### Context
Qualys API v2.0 returns XML responses. AI clients work better with JSON. We need to decide how to handle this mismatch.

### Decision
Automatically convert all XML responses to JSON using xml2js library.

### Rationale
- **AI Compatibility**: JSON is more AI-friendly than XML
- **Consistency**: All responses in the same format
- **Structure Preservation**: xml2js maintains XML structure

### Consequences
**Positive:**
- AI can parse and understand responses
- Consistent response format across all tools
- Preserves XML structure in JSON form

**Negative:**
- XML-specific features may be lost or awkward
- Large responses consume memory during parsing
- Some edge cases in XML structure

### Configuration Choices
```typescript
{
  explicitArray: false,  // Don't wrap single elements in arrays
  ignoreAttrs: false,    // Keep XML attributes
  mergeAttrs: true       // Merge attributes into element
}
```

### Alternatives Considered
1. **Return raw XML**: AI would struggle to parse
2. **Custom transformation**: More control but more maintenance
3. **Dual format**: Complex, inconsistent UX

---

## ADR-007: Environment Variables for Configuration

### Status
Accepted

### Context
The server needs configuration for:
- Qualys API URL (varies by region)
- Qualys username
- Qualys password

### Decision
Use environment variables for all configuration.

### Rationale
- **12-Factor App**: Follows configuration best practice
- **Security**: Avoids hardcoded credentials
- **Deployment Flexibility**: Works with any deployment mechanism
- **MCP Compatibility**: Claude Desktop passes env vars to MCP servers

### Consequences
**Positive:**
- Simple configuration mechanism
- Works with Claude Desktop MCP config
- No config file to manage

**Negative:**
- No validation until runtime
- Environment may be visible in process list
- No complex configuration support (lists, objects)

### Environment Variables
```bash
QUALYS_API_URL   # API endpoint (default: https://qualysapi.qualys.com)
QUALYS_USERNAME  # Required
QUALYS_PASSWORD  # Required
```

### Alternatives Considered
1. **Config file**: More complex, file management issues
2. **Command line args**: Credentials visible in process list
3. **Secrets manager integration**: Adds dependencies

---

## ADR-008: Single File Architecture

### Status
Accepted

### Context
The codebase is relatively small (~850 lines). We need to decide on the file organization.

### Decision
Keep all code in a single `src/index.ts` file.

### Rationale
- **Simplicity**: Easy to understand the entire codebase
- **Size**: Current code fits comfortably in one file
- **Build Simplicity**: Single entry point, no module resolution
- **Refactoring Later**: Can split when complexity warrants

### Consequences
**Positive:**
- Easy to read and understand
- Simple build and deployment
- No circular dependency issues

**Negative:**
- May become unwieldy as features grow
- Harder to unit test in isolation
- All code loaded even if not used

### When to Reconsider
- Code exceeds 1500 lines
- Clear module boundaries emerge
- Unit testing becomes difficult

### Future Structure (if needed)
```
src/
  index.ts          # Entry point
  server.ts         # MCP server setup
  tools/
    hosts.ts        # Host-related tools
    scans.ts        # Scan-related tools
    reports.ts      # Report-related tools
  lib/
    client.ts       # Qualys API client
    parser.ts       # XML parsing
    rate-limiter.ts # Rate limiting
```

### Alternatives Considered
1. **Modular from start**: Overhead for current size
2. **One file per tool**: Too granular
3. **Feature folders**: Overkill for current scope

---

## Pending Decisions

### PDR-001: OAuth 2.0 Support
**Status:** Deferred

**Context:** Qualys is adding OAuth 2.0 support. Should we implement it?

**Considerations:**
- Not yet universally available
- Would improve security posture
- Adds token management complexity

**Decision:** Wait for wider Qualys OAuth availability

---

### PDR-002: Response Caching
**Status:** Under Review

**Context:** Should we cache Qualys responses locally?

**Considerations:**
- Knowledge Base data is static
- Host data changes frequently
- Memory vs. freshness trade-off

**Candidates for Caching:**
- KnowledgeBase (vuln descriptions)
- Option profiles
- Scanner list

---

### PDR-003: Multi-Account Support
**Status:** Under Review

**Context:** Should we support multiple Qualys accounts?

**Considerations:**
- MSP use case
- Account switching mid-session
- Credential management complexity

---

## Open Questions and Gaps

1. **Testing Strategy**: What testing approach should be adopted?
2. **Versioning**: How should MCP server versions relate to Qualys API versions?
3. **Feature Parity**: Which Qualys API features should NOT be exposed?
4. **Error Granularity**: Should errors be more specific (typed error classes)?
5. **Observability**: When/how should telemetry be added?
