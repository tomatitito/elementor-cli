# CSS Cache Invalidation

After pushing changes to Elementor pages, the CSS cache needs to be invalidated so that browsers display the updated styles. The `elementor-cli push` command handles this automatically.

## How It Works

When you run `elementor-cli push`, the CLI performs two levels of cache invalidation:

### 1. REST API Invalidation (All Sites)

For every successfully pushed page, the CLI clears the `_elementor_css` and `_elementor_element_cache` meta fields via the WordPress REST API. This tells Elementor to regenerate the CSS the next time the page is viewed.

This works for all sites (local and remote) as long as the REST API is accessible.

### 2. Container WP-CLI Flush (Local Sites Only)

For sites running in Docker or Podman containers, you can configure the CLI to also run `wp elementor flush-css` inside the container. This command:

- Clears all Elementor CSS files from the uploads folder
- Removes any cached CSS transients
- Forces a complete CSS rebuild

This is more thorough than REST API invalidation alone and is recommended for local development environments.

## Configuration

To enable container-based CSS flushing, add a `container` section to your site configuration in `.elementor-cli.yaml`:

```yaml
sites:
  staging:
    url: http://localhost:8888
    username: admin
    appPassword: your-app-password
    container:
      runtime: podman    # or "docker"
      name: juki-wp      # container name
  production:
    url: https://example.com
    username: admin
    appPassword: your-app-password
    # No container config - uses REST API only
```

### Container Config Options

| Option | Required | Description |
|--------|----------|-------------|
| `runtime` | No | Container runtime: `docker` or `podman` (default: `docker`) |
| `name` | Yes | Name of the WordPress container |

### Finding Your Container Name

```bash
# Docker
docker ps --format '{{.Names}}'

# Podman
podman ps --format '{{.Names}}'
```

## Skipping Cache Invalidation

If you want to push changes without invalidating the cache (e.g., for performance when pushing many pages), use the `--no-flush` flag:

```bash
elementor-cli push 42 --no-flush
```

You can then manually invalidate the cache later:

```bash
# Via REST API
elementor-cli regenerate-css 42

# For container sites, also run:
docker exec <container-name> wp elementor flush-css --allow-root
# or
podman exec <container-name> wp elementor flush-css --allow-root
```

## Troubleshooting

### CSS Still Not Updating?

1. **Browser cache**: Hard refresh your browser (Cmd+Shift+R or Ctrl+Shift+R)

2. **Server-side cache**: If you're using a caching plugin (WP Super Cache, W3 Total Cache, etc.), clear its cache as well

3. **CDN cache**: If using Cloudflare or another CDN, purge the cache there

4. **Container not found**: Make sure the container name in your config matches exactly:
   ```bash
   podman ps --format '{{.Names}}'
   ```

### REST API Invalidation Failed

If you see a warning about CSS cache invalidation failing:

1. Check that your site URL and credentials are correct
2. Ensure the WordPress REST API is accessible
3. Try running `elementor-cli regenerate-css <page-id>` manually to see detailed errors

### Container Flush Failed

If the container-based flush fails:

1. Verify the container is running
2. Check the container name is correct
3. Ensure WP-CLI is installed in the container
4. Try running the command manually:
   ```bash
   podman exec <container-name> wp elementor flush-css --allow-root
   ```

## Remote Sites (SSH Support)

Currently, container-based flushing only works for local Docker/Podman containers. For remote production sites, the CLI uses REST API invalidation only.

If you find that REST API invalidation is not sufficient for your production site, you have a few options:

1. **Manual SSH**: Run `wp elementor flush-css` via SSH after pushing
2. **Deployment pipeline**: Add the flush command to your CI/CD pipeline
3. **Feature request**: Open an issue to add SSH support to elementor-cli

## See Also

- [regenerate-css command](../README.md) - Manual CSS regeneration
- [push command](../README.md) - Upload local changes
