# CawPlan Activity API

## Query Activities
- Endpoint: `POST /api/v1/public/openapi/activities/query`
- Query params:
    - `page_num` (int, default 1)
    - `page_size` (int, default 20, max 100)
    - `time_range` (string, e.g. `1d`, `1w`, `1m`, `3m`, `6m`, `1y`; default 7 days)
- Body:
    - `user_id` (string, optional) actor `unique_id`
    - `product_id` (string, optional)
    - `activity_types` (array, optional): `RELEASE`, `ISSUE`, `TICKET`, `VERSION`, `PRODUCT`, `USER`

## Response Fields (selected)
- `unique_id`
- `actor.unique_id`, `actor.display_name`, `actor.alternate_id`, `actor.avatar`
- `event.activity_scope` (user, product, version, system, organization)
- `event.display_message`
- `event.published` (ISO 8601)
- `event.type` (RELEASE, ISSUE, TICKET, VERSION, PRODUCT, USER)
- `targets[]`: `id`, `type` (product, product.version, product.line, product.type, user, critical_issue), `display_name`
- `status`: `COMPLETED`, `IN_PROGRESS`, `FAILED`, `CANCELLED`, `PENDING`
