# Runtimes

What each one expects, and the mistake people make with it.

---

## next-intl — Next.js App Router

```
i18n/routing.ts     defineRouting({ locales, defaultLocale })
i18n/request.ts     getRequestConfig — loads messages/{locale}.json
middleware.ts       createMiddleware(routing)
next.config.ts      createNextIntlPlugin('./i18n/request.ts')
```

Calls: `const t = useTranslations('namespace')` in client components,
`const t = await getTranslations('namespace')` in server components.

**The mistake.** `useTranslations` is a hook, so it only works inside a component body and
only in a client component. Half of an App Router tree is server components, where you need
`getTranslations` and an `await`. The extractor writes `useTranslations` because it is the
common case; if a file has no `'use client'` and does async work, change it by hand.

**The other mistake.** Routing. Once `middleware.ts` exists, every path is `/{locale}/...`
and every internal `<Link href="/pricing">` must come from `next-intl/navigation` or it
will drop the locale. This is the part that looks broken in production and fine locally.

---

## next-i18next — Next.js Pages Router

Catalogues live at `public/locales/{locale}/{namespace}.json` — one file per namespace, not
one per locale. `next-i18next.config.js` sits alongside `next.config.js`.

Calls: `const { t } = useTranslation('namespace')`.

**The mistake.** Every page needs `serverSideTranslations` in `getStaticProps` or
`getServerSideProps`, listing the namespaces that page uses. Forget it and the page renders
raw keys. There is no build error; you find out by looking.

---

## react-i18next — React, Vite, CRA

```
src/i18n.ts    i18n.use(initReactI18next).init({ resources, lng, fallbackLng })
```

Imported once, at the entry point, before anything renders.

Calls: `const { t } = useTranslation('namespace')`.

**The mistake.** Importing `./i18n` after the first render, or in a component rather than the
entry file. The first paint shows keys, then flips to text. Import it in `main.tsx` above
your `App` import.

---

## vue-i18n — Vue, Nuxt

`$t('key')` is global in templates, so no import or hook is needed there. In script setup you
need `const { t } = useI18n()`.

**The mistake.** `legacy: false` is required for the Composition API. Without it `useI18n`
returns something that looks right and behaves differently.

---

## svelte-i18n — Svelte

`import { t } from 'svelte-i18n'` and call `$t('key')` — a store, so the `$` matters.

**The mistake.** Locale data loads asynchronously. Render before `waitLocale()` resolves and
the page shows keys. Guard your root layout on it.

---

## paraglide — SvelteKit, and anywhere that wants compile-time messages

Messages compile to functions: `m.hero_title()`. There is no runtime key lookup, so a missing
key is a build error rather than a broken page — which is the point of it.

**The mistake.** Forgetting to re-run the compiler after `apply`. The catalogue changed; the
generated functions did not. Add it to your build script.

---

## plain — no dependency

`npx language-loop init` can generate a ~40-line `t()` that does nested key lookup and `{name}`
interpolation. Fine for a marketing site with two languages.

**When to stop using it.** The moment you need plurals, date or number formatting, or lazy
catalogue loading. Do not grow this file into a library that already exists — re-run `init`
and pick a real runtime.

---

## Choosing, if nothing is installed

| you have | use |
| --- | --- |
| Next.js App Router | next-intl |
| Next.js Pages Router | next-i18next |
| React, Vite, CRA | react-i18next |
| Vue or Nuxt | vue-i18n |
| SvelteKit | paraglide |
| Svelte without Kit | svelte-i18n |
| a static site, two languages | plain |

If something is already installed, use it. Two i18n runtimes in one app is worse than the
wrong one.
