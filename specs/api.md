# WordPress REST API

REST API endpoints and authentication for `elementor-cli`.

---

## Authentication

Uses WordPress Application Passwords (available since WordPress 5.6).

### HTTP Header

```
Authorization: Basic base64(username:application_password)
```

### Example Request

```bash
curl -X GET "https://example.com/wp-json/wp/v2/pages" \
  -H "Authorization: Basic $(echo -n 'admin:xxxx xxxx xxxx xxxx' | base64)"
```

---

## Endpoints

### Pages

| Action | Method | Endpoint |
|--------|--------|----------|
| List pages | GET | `/wp-json/wp/v2/pages` |
| Get page | GET | `/wp-json/wp/v2/pages/<id>` |
| Create page | POST | `/wp-json/wp/v2/pages` |
| Update page | PUT | `/wp-json/wp/v2/pages/<id>` |
| Delete page | DELETE | `/wp-json/wp/v2/pages/<id>` |
| Get revisions | GET | `/wp-json/wp/v2/pages/<id>/revisions` |

### Query Parameters

**List pages:**
```
GET /wp-json/wp/v2/pages?_fields=id,title,status,modified&per_page=100
```

**Get page for editing:**
```
GET /wp-json/wp/v2/pages/<id>?context=edit
```

---

## Elementor Meta Fields

When fetching a page with `context=edit`, Elementor data is in the `meta` object:

```json
{
  "id": 42,
  "title": { "rendered": "Home" },
  "status": "publish",
  "meta": {
    "_elementor_data": "[{\"id\":\"abc123\",...}]",
    "_elementor_page_settings": "{...}",
    "_elementor_edit_mode": "builder"
  }
}
```

| Meta Field | Type | Description |
|------------|------|-------------|
| `_elementor_data` | JSON string | Element tree (array of elements) |
| `_elementor_page_settings` | JSON string | Page-level settings |
| `_elementor_edit_mode` | string | Set to `"builder"` for Elementor pages |

---

## Updating a Page

### Request

```bash
PUT /wp-json/wp/v2/pages/42
Content-Type: application/json

{
  "title": "Updated Title",
  "meta": {
    "_elementor_data": "[{\"id\":\"abc123\",\"elType\":\"container\",...}]",
    "_elementor_page_settings": "{\"background_color\":\"#ffffff\"}"
  }
}
```

### Important Notes

1. `_elementor_data` must be a **JSON string** (double-encoded)
2. Always include `_elementor_edit_mode: "builder"` for Elementor pages
3. Use `context=edit` when fetching to get raw meta values

---

## Creating a Page

```bash
POST /wp-json/wp/v2/pages
Content-Type: application/json

{
  "title": "New Page",
  "status": "draft",
  "meta": {
    "_elementor_edit_mode": "builder",
    "_elementor_data": "[]",
    "_elementor_page_settings": "{}"
  }
}
```

---

## Revisions

### List Revisions

```bash
GET /wp-json/wp/v2/pages/42/revisions
```

Response:
```json
[
  {
    "id": 156,
    "parent": 42,
    "date": "2024-01-20T14:30:00",
    "author": 1,
    "meta": {
      "_elementor_data": "[...]"
    }
  }
]
```

### Restore Revision

To restore a revision, copy its `_elementor_data` to the parent page:

```bash
PUT /wp-json/wp/v2/pages/42
Content-Type: application/json

{
  "meta": {
    "_elementor_data": "<data from revision>"
  }
}
```

---

## Error Handling

### Common Errors

| Status | Code | Description |
|--------|------|-------------|
| 401 | `rest_cannot_read` | Invalid or missing credentials |
| 403 | `rest_forbidden` | User lacks permission |
| 404 | `rest_post_invalid_id` | Page not found |
| 400 | `rest_invalid_param` | Invalid request data |

### Error Response Format

```json
{
  "code": "rest_cannot_read",
  "message": "Sorry, you are not allowed to read this post.",
  "data": { "status": 401 }
}
```

---

## Rate Limiting

WordPress doesn't have built-in rate limiting, but:
- Some hosts impose limits
- Use reasonable delays between requests
- Batch operations where possible

---

## Testing the API

```bash
# Test connection
curl -s "https://example.com/wp-json/wp/v2/users/me" \
  -H "Authorization: Basic $(echo -n 'admin:xxxx xxxx' | base64)" \
  | jq .name

# List Elementor pages
curl -s "https://example.com/wp-json/wp/v2/pages?meta_key=_elementor_edit_mode" \
  -H "Authorization: Basic $(echo -n 'admin:xxxx xxxx' | base64)" \
  | jq '.[].title.rendered'
```
