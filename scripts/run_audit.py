import subprocess, sys
from pathlib import Path

r = subprocess.run(
    ['python', 'scripts/audit_names.py'],
    capture_output=True, encoding='utf-8', errors='replace'
)
Path('scripts/audit_report.txt').write_text(
    r.stdout + r.stderr, encoding='utf-8'
)
print(f"Exit code: {r.returncode}")
print(f"Report written to scripts/audit_report.txt")
