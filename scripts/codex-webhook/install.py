#!/usr/bin/env python3
"""Run on Alpuca after copying this directory into ~/scripts/codex-webhook."""
import os
from pathlib import Path
import plistlib
import re
import secrets
import shutil
import subprocess
import time
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
for attempt in range(6):
    loaded = subprocess.run(['launchctl','bootstrap',target,str(p)],capture_output=True,text=True)
    if loaded.returncode==0:
        break
    if attempt==5:
        raise SystemExit('LaunchAgent bootstrap failed: '+loaded.stderr.strip())
    # launchd can briefly return EIO while the previous job finishes bootout.
    time.sleep(1)
print('Installed '+label+'; credentials were not printed.')

# Register the local task receiver in the real desktop user's Codex configuration.
# The isolated notification-only Codex home above remains separate.
receiver = Path(__file__).resolve().with_name('desktop_mcp.py')
if receiver.exists():
    current = tomllib.loads(config.read_text()) if config.exists() else {}
    existing = current.get('mcp_servers',{}).get('grokbot_desktop_tasks')
    expected_args = [str(receiver)]
    if existing and (existing.get('command')!='/opt/homebrew/bin/python3' or existing.get('args')!=expected_args):
        raise SystemExit('Existing grokbot_desktop_tasks config conflicts; preserved it unchanged')
    backup = root/'config-before-desktop-mcp.toml'
    if config.exists() and not backup.exists():
        shutil.copy2(config,backup)
        backup.chmod(0o600)
    if not existing:
        subprocess.run(['/opt/homebrew/bin/codex','mcp','add','grokbot_desktop_tasks','--','/opt/homebrew/bin/python3',str(receiver)],check=True)
    text = config.read_text()
    header = '[mcp_servers.grokbot_desktop_tasks]'
    begin = text.index(header)+len(header)
    end = text.find('\n[',begin)
    if end<0:end=len(text)
    section = text[begin:end]
    for key,value in [('tool_timeout_sec','3600'),('startup_timeout_sec','20')]:
        pattern = r'(?m)^'+key+r'\s*=.*$'
        if re.search(pattern,section):section=re.sub(pattern,key+' = '+value,section)
        else:section+='\n'+key+' = '+value+'\n'
    updated = text[:begin]+section+text[end:]
    tomllib.loads(updated)  # Validate before modifying the existing config.
    config.write_text(updated)
    print('Registered grokbot_desktop_tasks MCP tools for new desktop chats.')
