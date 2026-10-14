#!/usr/bin/env python3
"""Run on Alpuca after copying this directory into ~/scripts/codex-webhook."""
import os
from pathlib import Path
import plistlib
import secrets
import subprocess
import tomllib

os.umask(0o077)
home = Path.home()
root = home/'.codex-webhook'
root.mkdir(mode=0o700,exist_ok=True)
for name in ['workspace','codex-home','logs']:
    (root/name).mkdir(mode=0o700,exist_ok=True)
token = root/'token'
if not token.exists():
    token.write_text(secrets.token_urlsafe(48)+'\n')
token.chmod(0o600)
auth = root/'codex-home/auth.json'
if not auth.exists():
    if not (home/'.codex/auth.json').exists():
        raise SystemExit('Sign into Codex CLI on this machine before installing')
    auth.symlink_to(home/'.codex/auth.json')
config = home/'.codex/config.toml'
model = tomllib.loads(config.read_text()).get('model','gpt-6-astra') if config.exists() else 'gpt-6-astra'
(root/'codex-home/config.toml').write_text('''model = "'''+model+'''"
model_reasoning_effort = "low"
approval_policy = "never"
sandbox_mode = "read-only"
web_search = "disabled"
[features]
shell_tool = false
unified_exec = false
code_mode_host = false
code_mode = false
multi_agent = false
[analytics]
enabled = false
''')
label = 'com.alpacapps.codex-webhook'
plist = {'Label':label,'ProgramArguments':['/opt/homebrew/bin/python3',str(Path(__file__).resolve().with_name('bridge.py'))],
         'WorkingDirectory':str(root/'workspace'),'EnvironmentVariables':{'PATH':'/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin','CODEX_BRIDGE_STATE':str(root)},
         'RunAtLoad':True,'KeepAlive':True,'ThrottleInterval':10,'ProcessType':'Background',
         'StandardOutPath':str(root/'logs/service.log'),'StandardErrorPath':str(root/'logs/error.log')}
p = home/'Library/LaunchAgents'/f'{label}.plist'
p.parent.mkdir(parents=True,exist_ok=True)
p.write_bytes(plistlib.dumps(plist))
target = f'gui/{os.getuid()}'
if subprocess.run(['launchctl','print',target+'/'+label],capture_output=True).returncode == 0:
    subprocess.run(['launchctl','bootout',target+'/'+label],check=True)
subprocess.run(['launchctl','bootstrap',target,str(p)],check=True)
print('Installed '+label+'; credentials were not printed.')
