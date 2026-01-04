//! GLM Orchestrator - MCP Server for Claude-GLM delegation
//!
//! This MCP server allows Claude Code to delegate code generation tasks
//! to GLM-4.7 via the `zai` command (cc-mirror).
//!
//! Workflow: Claude plans → GLM generates → Claude reviews

use anyhow::Result;
use clap::Parser;
use tracing::{info, Level};
use tracing_subscriber::FmtSubscriber;

mod mcp;

#[derive(Parser, Debug)]
#[command(name = "glm-orchestrator")]
#[command(about = "MCP server for Claude-GLM code generation delegation")]
struct Args {
    /// Path to zai binary
    #[arg(long, default_value = "~/.local/bin/zai")]
    zai_path: String,

    /// Enable debug logging
    #[arg(short, long)]
    debug: bool,
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();

    // Setup logging to stderr (stdout is used by MCP protocol)
    let level = if args.debug { Level::DEBUG } else { Level::INFO };
    let subscriber = FmtSubscriber::builder()
        .with_max_level(level)
        .with_writer(std::io::stderr)
        .finish();
    tracing::subscriber::set_global_default(subscriber)?;

    // Expand ~ in path
    let zai_path = shellexpand::tilde(&args.zai_path).to_string();
    
    info!("Starting GLM Orchestrator v{}", env!("CARGO_PKG_VERSION"));
    info!("Using zai at: {}", zai_path);

    // Start MCP server
    info!("Starting MCP server on stdio...");
    mcp::run_server(zai_path).await?;

    Ok(())
}
