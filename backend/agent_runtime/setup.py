"""Install the optional companion outside Notlinear's dependency-free server."""
import pathlib
import subprocess
import sys
import venv

target = pathlib.Path.home() / "Library/Application Support/Notlinear/agents/venv"
venv.EnvBuilder(with_pip=True).create(target)
subprocess.run([str(target / "bin/python"), "-m", "pip", "install", "-r",
                str(pathlib.Path(__file__).with_name("requirements.txt"))], check=True)
print("Subscription companion installed. Restart Notlinear, then open Settings.")
