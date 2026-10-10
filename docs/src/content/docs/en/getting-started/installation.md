---
title: Installation
description: Install Barq in your Bun project, create your first HTTP server, and learn the essential runtime settings.
---

# Installation

Get started with **Barq** in just a few minutes. All you need is the Bun runtime, the Barq package, and an entry file for your application.

This guide walks you through the process, from checking the requirements to running your server locally.

## Requirements

Before installing Barq, make sure you have the following:

- **[Bun](https://bun.sh/)** version 1.1 or later. Bun is the JavaScript runtime used to run Barq applications. It also provides the package manager and tools needed to run your project.
- **TypeScript (optional).** You can write your application in either JavaScript or TypeScript. Bun can execute TypeScript files directly, so you do not need a separate compilation step when running them this way. TypeScript is recommended for type checking, editor assistance, and catching certain errors during development.

To verify that Bun is installed, open your terminal and run:

```sh
bun --version
```

If the command prints a version number, Bun is available in your terminal. If your system cannot find the command, follow the installation instructions on the [official Bun website](https://bun.sh/).

## Install Barq

The fastest way to get started is to create a new directory, initialize it, and install the latest version of the package all at once:

```sh
mkdir test-barq && cd test-barq
bun init -y
bun add @barqel/barq@latest
```

This command adds the `@barqel/barq` package to your project's dependencies. 
*(If you already have an existing project, you can simply run `bun add @barqel/barq` inside it).*

## Import Barq

Barq is an ECMAScript Module (ESM) package. Use the standard `import` syntax to import the public exports you need from the package root:

```ts
import { App, json } from "@barqel/barq";
```

In this example:

- `App` is the entry point used to create a Barq application, according to the framework's API.
- `json` is a helper exported by the package that can be used wherever its API supports it.

Importing from `"barq"` gives you access to the package's public exports without importing internal files from its source directories.

**Note:** You do not need to install additional runtime libraries just to use Barq. The package has no additional runtime library dependencies, and Bun is the required runtime.

## Create an entry point

An entry point is the file where your application starts executing. Create the following file in your project:

```text
src/
└── index.ts
```

Add the server code you want to run to this file. If this is your first Barq application, follow the complete example in the [Quickstart](/getting-started/quickstart/).

Once the file is ready, start your application with:

```sh
bun run src/index.ts
```

This command tells Bun to execute the file directly. If your server listens on a specific port, you can send requests to it using its local address and configured port.

## Configure the server port

A port determines where your server accepts HTTP connections. For example, a server listening on port `3000` is commonly accessed locally at:

```text
http://localhost:3000
```

If you do not specify a port in `listen()` or `AppOptions.port`, Bun may select an available temporary port, depending on how the server is created and configured. This can be useful for certain development tests, but it is less convenient when you need a predictable address.

For a local service, you can explicitly configure the port or read it from the `PORT` environment variable, with `3000` as the default:

```ts
const port = Number(Bun.env.PORT ?? 3000);
```

Here is how the expression works:

1. It reads `Bun.env.PORT` if the `PORT` environment variable is defined.
2. It falls back to `3000` if the variable is missing.
3. It converts the resulting value to a number using `Number()`.

This expression only prepares the port value. You must pass it to the appropriate server configuration in your application. You should also ensure that `PORT` contains a valid number and that the selected port is available.

## What's next?

Now that Barq is installed and your entry point is ready, explore the topics most relevant to your next step:

- [Quickstart](/getting-started/quickstart/) — build your first application and learn how to run it.
- [Routing](/basics/routing/) — learn how to receive requests and define which route handles each one.
- [Request Context and Helpers](/basics/context/) — understand the tools available for working with requests and responses.
- [API Reference](/api-reference/) — explore Barq's public exports and available APIs.

If you are new to Barq, start with the **Quickstart**. It is the shortest path from installing the package to running your first application.
