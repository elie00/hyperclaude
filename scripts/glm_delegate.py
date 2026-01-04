"""
SKILL: Delegate to GLM

DESCRIPTION: Delegate code generation tasks to GLM-4.7 via the zai variant (cc-mirror).
             Uses your Z.AI Coding Plan quota, not API credits.

WHEN TO USE:
    - Rapid code generation
    - Prototyping
    - Boilerplate creation
    - When you want to save Claude tokens

CLI ARGUMENTS:
    --task       Task description for GLM (required)
    --context    Additional context (optional)
    --language   Programming language (optional)

USAGE:
    cd /Users/eybo/PycharmProjects/hyperclaude
    uv run python scripts/glm_delegate.py \\
        --task "create a REST API for user authentication" \\
        --language python
"""

import argparse
import subprocess
import sys
import tempfile
import os


def parse_args():
    """Parse CLI arguments."""
    parser = argparse.ArgumentParser(description="Delegate code generation to GLM-4.7")
    parser.add_argument("--task", required=True, help="Task description for GLM")
    parser.add_argument("--context", default="", help="Additional context")
    parser.add_argument("--language", default="", help="Programming language")
    
    args_to_parse = [arg for arg in sys.argv[1:] if not arg.endswith(".py")]
    return parser.parse_args(args_to_parse)


def main():
    """Delegate task to GLM-4.7 via zai."""
    args = parse_args()
    
    # Build the prompt
    prompt = f"Generate code for: {args.task}"
    if args.language:
        prompt = f"Generate {args.language} code for: {args.task}"
    if args.context:
        prompt += f"\n\nContext:\n{args.context}"
    
    prompt += "\n\nProvide only the code with minimal explanation."
    
    print("=" * 60)
    print("🔄 DELEGATING TO GLM-4.7 (via zai)")
    print("=" * 60)
    print(f"Task: {args.task}")
    if args.language:
        print(f"Language: {args.language}")
    print()
    
    # Create a temp file with the prompt
    with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False) as f:
        f.write(prompt)
        prompt_file = f.name
    
    try:
        # Call zai with the prompt using --print flag for non-interactive output
        zai_path = os.path.expanduser("~/.local/bin/zai")
        
        # Use zai in print mode to get direct output
        result = subprocess.run(
            [zai_path, "--print", "-p", prompt],
            capture_output=True,
            text=True,
            timeout=120,
            env={**os.environ, "TERM": "dumb"}
        )
        
        print("=" * 60)
        print("📝 GLM-4.7 RESPONSE:")
        print("=" * 60)
        
        if result.returncode == 0:
            print(result.stdout)
        else:
            # Try alternative: pipe prompt directly
            result = subprocess.run(
                [zai_path, "-p", prompt, "--output-format", "text"],
                capture_output=True,
                text=True,
                timeout=120
            )
            if result.stdout:
                print(result.stdout)
            else:
                print(f"Error: {result.stderr}")
        
        print()
        print("=" * 60)
        print("✅ Delegation complete. Claude should now review this code.")
        print("=" * 60)
        
    except subprocess.TimeoutExpired:
        print("❌ Timeout: GLM took too long to respond")
    except Exception as e:
        print(f"❌ Error: {e}")
    finally:
        os.unlink(prompt_file)


if __name__ == "__main__":
    main()
