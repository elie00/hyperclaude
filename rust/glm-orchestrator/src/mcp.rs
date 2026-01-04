//! MCP Server implementation - delegates to zai subprocess
//!
//! This spawns the `zai` command (GLM-4.7 via cc-mirror) and captures output.

use anyhow::Result;
use rmcp::model::{CallToolResult, Content, ServerCapabilities, ServerInfo};
use rmcp::{tool, ServerHandler, ServiceExt};
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tracing::{debug, info, warn};

#[derive(Clone)]
pub struct GlmDelegator {
    zai_path: String,
}

impl GlmDelegator {
    pub fn new(zai_path: String) -> Self {
        Self { zai_path }
    }

    /// Execute zai with a prompt and return the response
    async fn call_zai(&self, prompt: &str) -> Result<String> {
        info!("Delegating to zai: {} chars", prompt.len());
        debug!("Prompt: {}", &prompt[..prompt.len().min(100)]);

        // Use zai with --print flag for non-interactive output
        let mut child = Command::new(&self.zai_path)
            .args(["--print", "-p", prompt])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()?;

        let stdout = child.stdout.take().expect("Failed to capture stdout");
        let stderr = child.stderr.take().expect("Failed to capture stderr");

        // Read stdout
        let mut reader = BufReader::new(stdout);
        let mut output = String::new();
        let mut line = String::new();
        
        while reader.read_line(&mut line).await? > 0 {
            output.push_str(&line);
            line.clear();
        }

        // Check for errors
        let status = child.wait().await?;
        if !status.success() {
            let mut err_reader = BufReader::new(stderr);
            let mut err_output = String::new();
            err_reader.read_line(&mut err_output).await?;
            warn!("zai exited with error: {}", err_output);
        }

        info!("zai response: {} chars", output.len());
        Ok(output.trim().to_string())
    }
}

#[tool(tool_box)]
impl GlmDelegator {
    /// Delegate code generation to GLM-4.7 - Claude plans, GLM generates, Claude reviews
    #[tool(description = "Delegate code generation to GLM-4.7. Use this when you need rapid code generation. You (Claude) should plan first, then delegate generation to GLM, then review the result.")]
    async fn delegate_code(
        &self,
        #[tool(param)]
        #[schemars(description = "What code to generate - be specific about requirements")]
        task: String,
        #[tool(param)]
        #[schemars(description = "Programming language (e.g., python, rust, typescript)")]
        language: Option<String>,
        #[tool(param)]
        #[schemars(description = "Additional context, constraints, or specifications")]
        context: Option<String>,
    ) -> Result<CallToolResult, rmcp::Error> {
        let mut prompt = if let Some(lang) = &language {
            format!("Generate {} code for: {}", lang, task)
        } else {
            format!("Generate code for: {}", task)
        };

        if let Some(ctx) = &context {
            prompt.push_str(&format!("\n\nContext:\n{}", ctx));
        }

        prompt.push_str("\n\nProvide clean, production-ready code with minimal explanation.");

        match self.call_zai(&prompt).await {
            Ok(response) => {
                let result = format!(
                    "## GLM-4.7 Generated Code\n\n{}\n\n---\n*Claude: Please review this code for correctness, security, and best practices before using.*",
                    response
                );
                Ok(CallToolResult::success(vec![Content::text(result)]))
            }
            Err(e) => Ok(CallToolResult::error(vec![Content::text(format!(
                "Delegation failed: {}",
                e
            ))])),
        }
    }

    /// Quick code explanation via GLM
    #[tool(description = "Ask GLM-4.7 to explain code")]
    async fn glm_explain(
        &self,
        #[tool(param)]
        #[schemars(description = "Code to explain")]
        code: String,
    ) -> Result<CallToolResult, rmcp::Error> {
        let prompt = format!(
            "Explain this code clearly and concisely:\n\n```\n{}\n```",
            code
        );

        match self.call_zai(&prompt).await {
            Ok(response) => Ok(CallToolResult::success(vec![Content::text(response)])),
            Err(e) => Ok(CallToolResult::error(vec![Content::text(format!(
                "Error: {}",
                e
            ))])),
        }
    }

    /// General chat with GLM
    #[tool(description = "Send any prompt to GLM-4.7")]
    async fn glm_chat(
        &self,
        #[tool(param)]
        #[schemars(description = "Your message to GLM-4.7")]
        message: String,
    ) -> Result<CallToolResult, rmcp::Error> {
        match self.call_zai(&message).await {
            Ok(response) => Ok(CallToolResult::success(vec![Content::text(response)])),
            Err(e) => Ok(CallToolResult::error(vec![Content::text(format!(
                "Error: {}",
                e
            ))])),
        }
    }
}

#[tool(tool_box)]
impl ServerHandler for GlmDelegator {
    fn get_info(&self) -> ServerInfo {
        ServerInfo {
            instructions: Some(
                r#"# GLM-4.7 Code Generation Delegation

You have access to GLM-4.7 via the delegate_code tool.

## WORKFLOW: Plan → Delegate → Review

1. **PLAN (Claude)**: Analyze requirements, design architecture, break down tasks
2. **DELEGATE (GLM)**: Use delegate_code for code generation tasks
3. **REVIEW (Claude)**: Check generated code for correctness, security, best practices

## WHEN TO DELEGATE:
- Boilerplate code (CRUD, models, schemas)
- Prototypes and quick iterations
- Repetitive patterns
- Initial implementations

## WHEN TO KEEP IN CLAUDE:
- Architecture decisions
- Security-critical code
- Complex algorithms
- Final code review
- Debugging

## EXAMPLE:
1. User: "Create a user authentication system"
2. Claude: Plans the architecture (JWT, bcrypt, endpoints)
3. Claude: Calls delegate_code with detailed specs
4. GLM: Generates the code quickly
5. Claude: Reviews and refines the code"#
                    .into(),
            ),
            capabilities: ServerCapabilities::builder().enable_tools().build(),
            ..Default::default()
        }
    }
}

pub async fn run_server(zai_path: String) -> Result<()> {
    let server = GlmDelegator::new(zai_path);

    let service = server.serve(rmcp::transport::stdio()).await?;
    service.waiting().await?;

    Ok(())
}
