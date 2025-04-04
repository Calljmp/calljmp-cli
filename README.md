# Calljmp CLI

**Secure backend-as-a-service for mobile developers. No API keys. Full SQLite control.**

[![npm version](https://img.shields.io/npm/v/@calljmp/react-native)](https://www.npmjs.com/package/@calljmp/cli)
[![GitHub license](https://img.shields.io/github/license/Calljmp/calljmp-cli)](LICENSE)

## 🚀 Overview

Calljmp is a **secure backend designed for mobile developers**, providing:

- ✅ **Authentication** via **App Attestation (iOS)**
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

### 1️⃣ Configure project

Add ignores, generate types, and install dependencies.

```sh
calljmp configure
```

### 2️⃣ Login to Calljmp

Execute the login command to authenticate with your Calljmp account:

```sh
calljmp login
```

### 3️⃣ Local development

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

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 💬 Support & Community

If you have any questions or feedback:

- Follow [@calljmpdev](https://x.com/calljmpdev)
- Join the [Calljmp Discord](https://discord.gg/DHsrADPUC6)
- Open an issue in the [GitHub repo](https://github.com/Calljmp/calljmp-react-native/issues)
