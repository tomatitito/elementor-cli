# Working with Elementor JSON

How Elementor stores page content as JSON and how to make edits that control the visual output.

---

## Data Model

Elementor pages are stored as a **tree of elements**. Each element has:
- An **id** (random string like `"3a2f8c1"`)
- A **type** (`section`, `container`, `column`, or `widget`)
- **settings** (properties that control appearance and behavior)
- **child elements** (nested in the `elements` array)

```
Page
├── Container/Section
│   ├── Column (if section)
│   │   ├── Widget (heading)
│   │   ├── Widget (text)
│   │   └── Widget (button)
│   └── Column
│       └── Widget (image)
└── Container/Section
    └── Widget (form)
```

---

## Element Structure

Every element follows this structure:

```json
{
  "id": "7a3b2c1",
  "elType": "widget",
  "widgetType": "heading",
  "settings": {
    "title": "Welcome to My Site",
    "size": "xl",
    "header_size": "h1",
    "align": "center",
    "title_color": "#333333"
  },
  "elements": []
}
```

| Field | Description |
|-------|-------------|
| `id` | Unique identifier (random string) |
| `elType` | Element type: `container`, `section`, `column`, `widget` |
| `widgetType` | Widget name (only when `elType` is `widget`) |
| `settings` | Properties controlling appearance/behavior |
| `elements` | Child elements (nested array) |

---

## Common Widgets

### Heading

```json
{
  "widgetType": "heading",
  "settings": {
    "title": "Your Heading Text",
    "size": "default|small|medium|large|xl|xxl",
    "header_size": "h1|h2|h3|h4|h5|h6",
    "align": "left|center|right|justify",
    "title_color": "#hexcolor",
    "link": {
      "url": "https://example.com",
      "is_external": true,
      "nofollow": false
    }
  }
}
```

### Text Editor

```json
{
  "widgetType": "text-editor",
  "settings": {
    "editor": "<p>Your HTML content here</p>",
    "text_color": "#333333",
    "typography_font_size": { "unit": "px", "size": 16 }
  }
}
```

### Button

```json
{
  "widgetType": "button",
  "settings": {
    "text": "Click Me",
    "link": {
      "url": "https://example.com",
      "is_external": false
    },
    "align": "center",
    "size": "sm|md|lg|xl",
    "button_type": "default|info|success|warning|danger",
    "background_color": "#0073aa",
    "text_color": "#ffffff",
    "border_radius": { "unit": "px", "size": 5 },
    "hover_color": "#005177"
  }
}
```

### Image

```json
{
  "widgetType": "image",
  "settings": {
    "image": {
      "id": 123,
      "url": "https://site.com/image.jpg"
    },
    "image_size": "full|large|medium|thumbnail",
    "align": "center",
    "caption_source": "none|attachment|custom",
    "caption": "Image caption text",
    "link_to": "none|file|custom",
    "width": { "unit": "px", "size": 400 },
    "height": { "unit": "px", "size": 300 }
  }
}
```

---

## Containers and Sections

### Container (Modern, Flexbox-based)

```json
{
  "id": "abc123",
  "elType": "container",
  "settings": {
    "content_width": "boxed|full",
    "flex_direction": "row|column",
    "flex_justify_content": "flex-start|center|flex-end|space-between|space-around",
    "flex_align_items": "flex-start|center|flex-end|stretch",
    "flex_gap": { "unit": "px", "size": 20 },
    "padding": {
      "unit": "px",
      "top": "40",
      "right": "20",
      "bottom": "40",
      "left": "20"
    },
    "background_background": "classic|gradient",
    "background_color": "#f5f5f5"
  },
  "elements": []
}
```

### Section (Legacy, Table-based)

```json
{
  "id": "section1",
  "elType": "section",
  "settings": {
    "layout": "boxed|full_width",
    "structure": "10|20|30|...",
    "height": "default|min-height|full",
    "min_height": { "unit": "vh", "size": 50 }
  },
  "elements": [
    {
      "elType": "column",
      "settings": { "_column_size": 50 },
      "elements": []
    }
  ]
}
```

---

## Settings to CSS Mapping

Understanding how settings translate to CSS:

| Setting | CSS Output |
|---------|------------|
| `"align": "center"` | `text-align: center;` |
| `"title_color": "#333"` | `color: #333333;` |
| `"typography_font_size": {"size": 48, "unit": "px"}` | `font-size: 48px;` |
| `"padding": {"top": "40", "unit": "px"}` | `padding-top: 40px;` |
| `"background_color": "#f5f5f5"` | `background-color: #f5f5f5;` |
| `"border_radius": {"size": 10, "unit": "px"}` | `border-radius: 10px;` |

---

## Responsive Settings

Settings can have device-specific values using suffixes:

```json
{
  "settings": {
    "typography_font_size": { "unit": "px", "size": 48 },
    "typography_font_size_tablet": { "unit": "px", "size": 36 },
    "typography_font_size_mobile": { "unit": "px", "size": 24 },

    "align": "center",
    "align_tablet": "left",
    "align_mobile": "left"
  }
}
```

| Suffix | Breakpoint |
|--------|------------|
| (none) | Desktop (default) |
| `_tablet` | Tablet |
| `_mobile` | Mobile |

---

## Practical Examples

### Change Heading Text and Color

```json
// Before
{ "title": "Old Heading", "title_color": "#000000" }

// After
{ "title": "New Heading Text", "title_color": "#0073aa" }
```

### Add a Button

Add to a container's `elements` array:

```json
{
  "id": "new_button_1",
  "elType": "widget",
  "widgetType": "button",
  "settings": {
    "text": "Get Started",
    "link": { "url": "/contact", "is_external": false },
    "size": "lg",
    "align": "center",
    "background_color": "#28a745",
    "text_color": "#ffffff"
  },
  "elements": []
}
```

### Adjust Spacing

```json
{
  "settings": {
    "padding": {
      "unit": "px",
      "top": "60",
      "right": "30",
      "bottom": "60",
      "left": "30",
      "isLinked": false
    },
    "margin": {
      "unit": "px",
      "top": "0",
      "bottom": "40",
      "isLinked": false
    }
  }
}
```

### Change Background

**Solid color:**
```json
{
  "background_background": "classic",
  "background_color": "#f8f9fa"
}
```

**Gradient:**
```json
{
  "background_background": "gradient",
  "background_color": "#667eea",
  "background_color_b": "#764ba2",
  "background_gradient_type": "linear",
  "background_gradient_angle": { "unit": "deg", "size": 135 }
}
```

**Image:**
```json
{
  "background_background": "classic",
  "background_image": { "id": 456, "url": "https://site.com/bg.jpg" },
  "background_position": "center center",
  "background_size": "cover"
}
```

---

## Global Styles

Reference site-wide variables using `__globals__`:

```json
{
  "settings": {
    "title_color": "",
    "__globals__": {
      "title_color": "globals/colors?id=primary"
    }
  }
}
```

---

## Discovering Widget Settings

To find all available settings for a widget:

1. **Create a page in Elementor** with the widget you want
2. **Configure it visually** with the settings you need
3. **Pull the page** using `elementor-cli pull <page-id>`
4. **Inspect the JSON** in `.elementor-cli/pages/<site>/<page-id>/elements.json`

This reverse-engineering approach reveals exact setting names and value formats.

---

## Common Gotchas

| Issue | Solution |
|-------|----------|
| Duplicate IDs | Element IDs must be unique - generate random strings |
| Numeric values | Use object format: `{"unit": "px", "size": 16}` |
| Empty elements | Widgets must have `"elements": []` even with no children |
| HTML in strings | Properly escape HTML content in JSON |
| Case sensitivity | Setting names are case-sensitive |
| Linked values | Set `"isLinked": false` for different padding/margin per side |
