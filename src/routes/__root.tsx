import { HeadContent, Scripts, createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { TanStackDevtools } from "@tanstack/react-devtools";
import TanStackQueryDevtools from "../integrations/tanstack-query/devtools";
import { AuthProvider } from "../lib/auth-context";
import { getCurrentUser } from "../lib/server/auth";
import type { QueryClient } from "@tanstack/react-query";
import type { AuthUser } from "../lib/auth-context";

import appCss from "../styles.css?url";

interface MyRouterContext {
  queryClient: QueryClient;
  user: AuthUser | null;
}

const THEME_INIT_SCRIPT = `(function(){try{var stored=window.localStorage.getItem('theme');var mode=(stored==='light'||stored==='dark'||stored==='auto')?stored:'auto';var prefersDark=window.matchMedia('(prefers-color-scheme: dark)').matches;var resolved=mode==='auto'?(prefersDark?'dark':'light'):mode;var root=document.documentElement;root.classList.remove('light','dark');root.classList.add(resolved);if(mode==='auto'){root.removeAttribute('data-theme')}else{root.setAttribute('data-theme',mode)}root.style.colorScheme=resolved;}catch(e){}})();`;

export const Route = createRootRouteWithContext<MyRouterContext>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Omoiyari POS" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  loader: async () => {
    const user = await getCurrentUser();
    return { user };
  },
  component: RootDocument,
});

function RootDocument() {
  const { user } = Route.useLoaderData();

  return (
    <html lang="id" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <HeadContent />
      </head>
      <body className="font-sans antialiased wrap-anywhere">
        <AuthProvider user={user ?? null} isLoading={false}>
          <Outlet />
          <TanStackDevtools
            config={{ position: "bottom-right" }}
            plugins={[
              {
                name: "Tanstack Router",
                render: <TanStackRouterDevtoolsPanel />,
              },
              TanStackQueryDevtools,
            ]}
          />
        </AuthProvider>
        <Scripts />
      </body>
    </html>
  );
}
