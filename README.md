# Calljmp CLI

**Secure backend-as-a-service for mobile developers. No API keys. Full SQLite control.**

[![npm version](https://img.shields.io/npm/v/@calljmp/cli)](https://www.npmjs.com/package/@calljmp/cli)
[![GitHub license](https://img.shields.io/github/license/Calljmp/calljmp-cli)](LICENSE)

## Overview

**Calljmp** is a secure backend-as-a-service designed for mobile developers. The **CLI** provides command-line tools to manage your Calljmp projects, services, and deployments.

### Key Features

- **Authentication** via App Attestation (iOS) and Play Integrity (Android)
- **Full SQLite database access** with no restrictions - run raw SQL
- **Secure cloud storage** with organized bucket management
- **Local development** server with hot reload
- **Database migrations** and schema management
- **Cloud deployment** with one command
- **Environment management** for secrets and configuration
- **Code generation** for types and resources

**Website**: [calljmp.com](https://calljmp.com)  
**Documentation**: [docs.calljmp.com](https://docs.calljmp.com)  
**Follow**: [@calljmpdev](https://x.com/calljmpdev)

---

## Installation

Install the CLI globally via npm:

```sh
npm install -g @calljmp/cli
```

or via yarn:

```sh
yarn global add @calljmp/cli
```

---

## Getting Started

The Calljmp CLI helps you build, test, and deploy your backend services. Most commands require you to be in a project root directory.

### Available Commands

- Project Setup: `calljmp setup` - Initialize and link your project
- Local Development: `calljmp start` - Run development server with hot reload
- Database Management: `calljmp database` - Manage schema, migrations, and data
- Service Deployment: `calljmp service deploy` - Deploy to production
- Code Generation: `calljmp service generate` - Generate types and resources
- Environment Management: Configure secrets and variables securely

For detailed usage examples, command reference, and comprehensive guides, visit our [documentation](https://docs.calljmp.com).

## Security & Environment Variables

The CLI supports secure environment variable management. Variables can be defined in `.env` files with `CALLJMP_` prefix or in `.service.env` files. Use `SECRET_` prefix for encrypted values.

Learn more about security and configuration in our [documentation](https://docs.calljmp.com).

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support & Community

If you have any questions or feedback:

- Follow [@calljmpdev](https://x.com/calljmpdev)
- Join the Calljmp Discord: https://discord.gg/DHsrADPUC6
- Open an issue in the GitHub repo: https://github.com/Calljmp/calljmp-cli/issues
