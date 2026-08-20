# Polis

See the [documentation index](./docs/README.md) for technical references and design records.

## Requirements

- Node.js 22 or later
- npm 11 or later

## Install dependencies

```sh
npm install
```

## Run the development server

```sh
npm run dev
```

Vite prints the local URL when the server starts.

## Run checks

```sh
npm test
npm run typecheck
npm run lint
```

Run tests continuously while editing with:

```sh
npm run test:watch
```

## Run benchmarks

Print tab-separated terrain and starfield complexity measurements:

```sh
npm run benchmark:complexity
```

Run the distribution throughput benchmarks:

```sh
npm run benchmark:distributions
```

Print tracker diagnostics for the ordinary, dense, and known-collision cases:

```sh
npm run benchmark:birds-tracker
```

Pass one or more case names to run a subset, such as:

```sh
npm run benchmark:birds-tracker -- known-polis-3-meeting
```

Profile Birds engine time inside distributions, hashing, address encoding, and other
model work:

```sh
npm run profile:birds-engine
```

## Build and preview

Create a production build:

```sh
npm run build
```

Serve the production build locally:

```sh
npm run preview
```
