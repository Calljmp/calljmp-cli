# Calljmp CLI

**Secure backend-as-a-service for mobile developers. No API keys. Full SQLite control.**

[![npm version](https://img.shields.io/npm/v/@calljmp/cli)](https://www.npmjs.com/package/@calljmp/cli)
[![GitHub license](https://img.shields.io/github/license/Calljmp/calljmp-cli)](LICENSE)

## 🚀 Overview

Calljmp is a **secure backend designed for mobile developers**, providing:

- ✅ **Authentication** via **App Attestation (iOS)** and **Play Integrity (Android)**
- ✅ **Full SQLite database access** (no restrictions, run raw SQL)
- ✅ **Dynamic permissions** for users & roles
- ✅ **React Native SDK** for seamless integration

🔹 **Website**: [calljmp.com](https://calljmp.com)  
🔹 **Follow**: [@calljmpdev](https://x.com/calljmpdev)

---

## 📦 Installation

Install the CLI globally via npm:

```sh
npm install -g @calljmp/cli
```

or via yarn:

```sh
yarn global add @calljmp/cli
```

---

## 🛠️ Setup & Usage

Most commands require current directory to be a project root directory when executing them. You can optionally supply a project root directory with `--project <project-directory>` flag.

### 1️⃣ Setup and link project

Add ignores, generate types, and install dependencies. It will also walk you through the login and linking process.

```sh
calljmp setup
```

### 2️⃣ Local development

Run the local development server to develop your backend locally:

```sh
calljmp start
```

If you want to run the local server in a different port, you can specify it with the `--port` flag:

```sh
calljmp start --port 8080
```

If you want to persist the data between restarts, you can specify the `--persist-database` flag:

```sh
calljmp start --persist-database
```

### 3️⃣ Managing database

Synchronize the database schema from your cloud project to local database:

```sh
calljmp database pull
```

You can reset the local database to its initial state with:

```sh
calljmp database reset
```

### 4️⃣ Deploy to Calljmp

Deploy your local changes to the cloud:

```sh
calljmp deploy
```

### Code generation

Generate TypeScript code for environment variables, database, and resources:

```sh
calljmp generate
```

### Environment variables

You can set environment variables in the `.env` file with `CALLJMP_` prefix or without prefix in `.service.env`. In order to protect a value upon deployment and access outside of the service scope prepend key with `SECRET_` prefix. The CLI will automatically load them when you run the commands.

For example:

`.env`:

```sh
CALLJMP_SOME_TOKEN = "not a secret token"
CALLJMP_SECRET_TOKEN = "encrypted secret token"
```

`.service.env`:

```sh
ANOTHER_TOKEN = "another public token"
SECRET_ANOTHER_SAFE_TOKEN = "encrypted another secret token"
```

Then in code you will have access to:

```typescript
import { Service } from './service';

const service = Service();

service.get('/', async c => {
  // Evaluate access control to your service
  {
    console.debug(
      'Access',
      c.var.trusted,
      c.var.userId,
      c.var.platform,
      c.var.serviceId
    );

    if (!c.var.trusted && !c.env.DEVELOPMENT) {
      // Calljmp was not able to confirm the device and app integrity when the service was called.
      return c.json({ error: 'Unauthorized' }, 401);
    }

    if (!c.var.userId) {
      // User is not authenticated.
      return c.json({ error: 'Unathenticated' }, 401);
    }
  }

  // Access environment variables and secrets
  {
    console.debug('Variables', c.env.SOME_KEY, c.env.ANOTHER_KEY);
    console.debug(
      'Secrets',
      c.env.ACTUAL_SECRET_KEY,
      c.env.COMMON_VERY_SECRET_KEY
    );
  }

  // Access database and return query result
  {
    const result = await c.env.db.prepare('PRAGMA table_info(users)').run();
    return c.json({ result });
  }
});

export default service;
```

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 💬 Support & Community

If you have any questions or feedback:

- Follow [@calljmpdev](https://x.com/calljmpdev)
- Join the [Calljmp Discord](https://discord.gg/DHsrADPUC6)
- Open an issue in the [GitHub repo](https://github.com/Calljmp/calljmp-cli/issues)
