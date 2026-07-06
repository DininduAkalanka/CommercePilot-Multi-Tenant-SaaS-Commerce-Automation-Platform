# CommercePilot — Agent Rules

## Architecture Rules (NON-NEGOTIABLE)

1. **Read all Documents/ PDFs before every session.** They are the source of truth.
2. **Never violate Clean Architecture.** Dependencies flow inward only: Presentation → Application → Domain → Infrastructure.
3. **Follow SOLID principles.** Every service has one reason to change.
4. **Multi-tenancy is mandatory.** Every query MUST filter by `tenant_id`. No exceptions.
5. **Business logic lives in Services, never in Controllers.** Controllers only orchestrate.
6. **No cross-module DB access.** Modules communicate via service interfaces only.
7. **Never hard-delete records.** Use `deleted_at` (soft delete) on all business tables.
8. **Every AI call must be logged** to `AIProcessingLog` with input, output, model, stage, and processing_time_ms.
9. **All UUIDs are generated in the backend**, not in the database.
10. **Audit logs are immutable.** Never update or delete an `AuditLog` record.
11. **Never duplicate logic.** If you find similar code in two places, extract a shared service.
12. **Every external dependency must be abstracted** behind an interface (e.g., `IEmailService`, `IEcommerceAdapter`, `IWhatsAppAdapter`).
13. **All tests must pass before marking a task complete.** Run `npm run test` and `npm run test:e2e`.
14. **Security by design.** Validate all inputs with class-validator DTOs. Use Helmet. Rate-limit public endpoints.
15. **No temporary code.** No `// TODO remove later`. Build production-quality from the start.

## Coding Style

- TypeScript strict mode enabled at all times
- Use `async/await` — no raw Promise chains
- Use NestJS decorators and dependency injection — no manual `new ServiceClass()`
- DTOs use `class-validator` decorators
- Errors use NestJS exception classes (`BadRequestException`, `NotFoundException`, etc.)
- All services are `@Injectable()` and registered in their module
- Use `readonly` for injected dependencies
- Use barrel exports (`index.ts`) for each module's public API

## File Naming

- Files: `kebab-case.ts`
- Classes: `PascalCase`
- Interfaces: `I` prefix (`IEmailService`)
- DTOs: suffix `.dto.ts`
- Guards: suffix `.guard.ts`
- Services: suffix `.service.ts`
- Controllers: suffix `.controller.ts`
- Modules: suffix `.module.ts`

## Testing Rules

- Every service must have a unit test file (`*.spec.ts`)
- Mock all external dependencies in unit tests
- Integration tests cover the full happy path + cross-tenant isolation
- Use `jest` + `@nestjs/testing`

## Git Rules

- Commit message format: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`
- Never commit `.env` files
- Always commit `prisma/schema.prisma` changes with a migration

## AI Engine Rules

- System prompts are versioned constants in `src/modules/ai-engine/prompts/`
- Never inline prompts in service methods
- Always log the full prompt + response to `AIProcessingLog`
- Confidence scores are composite (intent + product_match + completeness)
- AI must NEVER invent products — always match against tenant catalog via RAG
