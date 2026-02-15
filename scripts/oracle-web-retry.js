#!/usr/bin/env node

/**
 * Oracle Cloud Always Free ARM Auto-Retry (Web Console Method)
 *
 * This script monitors the Oracle Cloud web console session and automatically
 * retries instance creation when capacity becomes available.
 *
 * Since the web UI doesn't have a public API we can use unauthenticated,
 * the best approach is to use the Oracle CLI which we've already installed.
 *
 * However, since CLI setup requires interactive steps, let's provide clear
 * instructions for the user to complete the setup.
 */

console.log(`
╔══════════════════════════════════════════════════════════════╗
║  Oracle Cloud Always Free ARM - Setup Instructions          ║
╚══════════════════════════════════════════════════════════════╝

The Oracle CLI has been installed successfully!

To complete the setup and enable auto-retry, follow these steps:

STEP 1: Configure Oracle CLI
─────────────────────────────
Run this command on the DO droplet:

    ~/bin/oci setup config

You'll be asked for:

1. Config location: Press ENTER (use default: /root/.oci/config)

2. User OCID:
   - In Oracle Console, click Profile icon (top right) → User Settings
   - Copy the OCID (starts with "ocid1.user.oc1..")

3. Tenancy OCID:
   - In Oracle Console, click Profile → Tenancy
   - Copy the OCID (starts with "ocid1.tenancy.oc1..")

4. Region: us-phoenix-1

5. Generate API key: Y (yes)

6. Key location: Press ENTER (use default)

7. Passphrase: Press ENTER twice (no passphrase)


STEP 2: Upload API Public Key to Oracle
────────────────────────────────────────
After the CLI setup completes:

1. Display the public key:
   cat ~/.oci/oci_api_key_public.pem

2. Copy the entire output (including BEGIN/END lines)

3. In Oracle Console:
   - Profile → User Settings → API Keys → Add API Key
   - Select "Paste Public Key"
   - Paste the key → Add


STEP 3: Test Oracle CLI
────────────────────────
   ~/bin/oci iam region list

If this works, you're ready!


STEP 4: Start Auto-Provisioning
────────────────────────────────
We'll create a simplified retry script that uses the Oracle CLI.

When you're ready, I'll provide the final auto-retry script!

╔══════════════════════════════════════════════════════════════╗
║  Ready to continue? Complete steps 1-3 above first.         ║
╚══════════════════════════════════════════════════════════════╝
`);

process.exit(0);
