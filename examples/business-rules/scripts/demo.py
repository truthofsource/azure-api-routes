"""Run the Node reference with fictional inputs; no API/database/token calls."""
from pathlib import Path
import subprocess,json
def demo():
    result=subprocess.run(['node','--experimental-strip-types','src/example.mjs'],cwd=Path(__file__).resolve().parents[1],capture_output=True,text=True,check=True)
    return json.loads(result.stdout)
if __name__=='__main__':print(json.dumps(demo(),indent=2))
