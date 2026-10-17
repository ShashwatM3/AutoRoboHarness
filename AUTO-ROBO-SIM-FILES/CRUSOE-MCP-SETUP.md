# Crusoe MCP setup on this Mac

This lets Codex read your Crusoe projects, usage, and available quota information directly. The Cloud MCP is read-only. It cannot raise limits or add a payment method.

## 1. Create the Cloud key pair

The [Crusoe console](https://console.crusoecloud.com/) has a **Security → API Keys** page. Create a Cloud API key pair and save its **access key ID** and **secret key** privately. Use the organization and project that hold AutoRoboHarness's inference key.

The MCP needs this Cloud key pair. Our `CRUSOE_API_KEY` in the project's `.env` is an inference key. [Crusoe CLI authentication instructions](https://docs.crusoecloud.com/installing-the-cli/index.html) explain the Cloud credentials.

## 2. Save those credentials on your Mac

Node.js and Codex are already installed here. A new terminal can run:

```sh
brew install crusoecloud/cli/crusoe
crusoe config init
```

The setup asks for the key pair and default project. Paste the values into those prompts, keeping them out of chat. Then run:

```sh
chmod 600 ~/.crusoe/config
crusoe whoami
```

Your account name should appear. If it fails, the MCP will also need its credentials fixed. The credentials stay in your home directory, outside this repository.

## 3. Register the MCP for this Orca Codex agent

This agent uses `~/.codex-nuron`, so these commands target that configuration explicitly:

```sh
CODEX_HOME="$HOME/.codex-nuron" codex mcp add crusoe-cloud -- npx -y @crusoeai/cloud-mcp
CODEX_HOME="$HOME/.codex-nuron" codex mcp list
```

The list should contain `crusoe-cloud`. This confirms registration; the next step confirms it can reach your account. The command combines [Crusoe's MCP connection details](https://support.crusoecloud.com/hc/en-us/articles/47835150255131-How-To-Set-Up-the-Crusoe-Cloud-MCP-Server-With-Claude-Cursor-and-Other-MCP-Clients) with [Codex's STDIO MCP setup](https://developers.openai.com/codex/mcp/).

## 4. Start a fresh Codex session and ask it to check

A new Codex agent session in Orca can load the new tools. The AutoRobo server terminal can keep running.

The first message can be:

> Use Crusoe MCP to confirm my identity, list my projects, select the project used by AutoRoboHarness, and inspect its project and organization quotas and usage. Tell me whether the tools expose Lightning's serverless RPM and TPM limits. Keep credentials private.

The relevant tools are `get_user_identity`, `list_available_projects`, `use_project`, `list_project_quotas`, `list_org_quotas`, and `get_usage_by_project`. Successful account and project responses confirm authentication. The quota tools may expose infrastructure limits without the specific serverless model limits; those still need the Foundry console or Crusoe support if absent.

The MCP's own 60-query-per-minute limit applies to its Cloud API queries. It does not increase the separate serverless inference quota used by our robots.

For Claude Code too, the same saved Cloud credentials can be reused after registering `claude mcp add crusoe-cloud -- npx -y @crusoeai/cloud-mcp` in Claude's intended project, then starting a fresh Claude session.

The [Crusoe hackathon skill](https://github.com/crusoecloud/crusoe-developer-hub/blob/main/examples/hackathons/crusoe-cv-recursive-agents-hackathon/crusoe-cv-recursive-agents-hackathon-skill.md) is the companion reference for inference endpoints, exact model discovery, and 429 troubleshooting. The live `/v1/models` response settles model spelling when examples differ.
