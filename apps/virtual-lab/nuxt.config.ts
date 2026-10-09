import { fileURLToPath } from 'node:url';

/**
 * The Virtual Lab imports the workspace packages from their TypeScript sources,
 * the same sources CI and the edge toolchain compile. There is no second
 * implementation of the compiler or the engine in the browser: the lab renders
 * what `@agrirobots/engine` produced.
 */
const WORKSPACE_PACKAGES = [
  'contracts',
  'domain-model',
  'compiler-core',
  'policy',
  'engine',
] as const;

function workspaceSource(pkg: string): string {
  return fileURLToPath(new URL(`../../packages/${pkg}/src/index.ts`, import.meta.url));
}

const alias: Record<string, string> = {};
for (const pkg of WORKSPACE_PACKAGES) {
  alias[`@agrirobots/${pkg}`] = workspaceSource(pkg);
}

export default defineNuxtConfig({
  // Nuxt 4 semantics are the default in 4.x, so no compatibility knob is needed;
  // the date pins Nitro's behaviour between releases.
  compatibilityDate: '2026-10-09',
  ssr: true,
  devtools: { enabled: false },

  // The lab is served inside a proxied preview host, so the dev server binds
  // every interface and does not reject unknown origins. Nothing here calls
  // localhost from the browser: the client only uses relative /api paths.
  devServer: {
    host: '0.0.0.0',
    port: 3000,
  },

  css: ['~/assets/css/main.css'],

  app: {
    head: {
      title: 'AgriRobots Virtual Lab',
      meta: [
        {
          name: 'description',
          content:
            'ARACNID egg-collection round: compiled agri.task/v1 IR executed against a kinematic twin.',
        },
        { name: 'color-scheme', content: 'dark' },
      ],
    },
  },

  alias,

  typescript: {
    strict: true,
    typeCheck: false,
  },

  vite: {
    server: {
      // The lab is served through a proxied preview host whose name is not known
      // at build time. Host binding stays with `devServer` above; this only
      // widens the dev server's Host-header allow-list.
      allowedHosts: true,
    },
    // Linked workspace packages ship TypeScript sources; pre-bundling them would
    // hide the very code the lab is meant to show.
    optimizeDeps: {
      exclude: WORKSPACE_PACKAGES.map((pkg) => `@agrirobots/${pkg}`),
    },
  },

  nitro: {
    // Bundle the workspace packages into the server instead of externalising
    // them: their entry points are .ts sources, which Node cannot import.
    externals: {
      inline: [/@agrirobots\//],
    },
  },
});
