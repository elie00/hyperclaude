"""
SKILL: GLM Code Generation

DESCRIPTION: Generate code using GLM-4.7 via the model-orchestrator MCP server.
             Fast and cost-effective for prototypes, boilerplate, and initial implementations.

WHEN TO USE:
    - Rapid prototyping
    - Boilerplate code generation
    - Initial implementations
    - Simple utility functions

CLI ARGUMENTS:
    --prompt    What code to generate (required)
    --language  Programming language (optional)

USAGE:
    cd /Users/eybo/PycharmProjects/Continuous-Claude-v2
    uv run python -m runtime.harness scripts/glm_generate.py \\
        --prompt "fibonacci function" \\
        --language python
"""

import argparse
import asyncio
import sys

from runtime.mcp_client import McpClientManager


def parse_args():
    """Parse CLI arguments."""
    parser = argparse.ArgumentParser(description="Generate code using GLM-4.7")
    parser.add_argument("--prompt", required=True, help="What code to generate")
    parser.add_argument("--language", default=None, help="Programming language (optional)")
    
    # Filter out script path from sys.argv (harness adds it)
    args_to_parse = [arg for arg in sys.argv[1:] if not arg.endswith(".py")]
    return parser.parse_args(args_to_parse)


async def main():
    """Main skill workflow."""
    args = parse_args()
    
    print(f"🚀 Generating code with GLM-4.7...")
    print(f"   Prompt: {args.prompt}")
    if args.language:
        print(f"   Language: {args.language}")
    print()
    
    # Initialize MCP client
    manager = McpClientManager()
    await manager.initialize()
    
    # Call the GLM generate tool
    params = {"prompt": args.prompt}
    if args.language:
        params["language"] = args.language
    
    result = await manager.call_tool("model-orchestrator__glm_generate", params)
    
    print("=" * 60)
    print("GENERATED CODE:")
    print("=" * 60)
    print(result)
    
    return result


if __name__ == "__main__":
    asyncio.run(main())
