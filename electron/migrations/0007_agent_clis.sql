CREATE TABLE agent_clis (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    command TEXT NOT NULL,
    args_template TEXT NOT NULL,
    resume_args_template TEXT NOT NULL DEFAULT '[]',
    terminal_resume_template TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    is_builtin INTEGER NOT NULL DEFAULT 0
);

-- args_template / resume_args_template are JSON arrays of argv tokens; {prompt} and
-- {resume_id} are substituted verbatim into whichever template applies, so a resumed
-- headless run can reorder/insert flags (e.g. codex's "exec resume <id> ...") not just
-- append. terminal_resume_template is the plain human command for interactive terminal
-- use (no headless-only flags), shown by the Sessions view's "copy command" action.
INSERT INTO agent_clis (id, label, command, args_template, resume_args_template, terminal_resume_template, enabled, is_builtin) VALUES
    ('claude', 'Claude Code', 'claude',
     '["-p","{prompt}","--output-format","stream-json","--verbose","--permission-mode","bypassPermissions"]',
     '["--resume","{resume_id}","-p","{prompt}","--output-format","stream-json","--verbose","--permission-mode","bypassPermissions"]',
     'claude --resume {resume_id}',
     1, 1),
    ('codex', 'Codex', 'codex',
     '["exec","--json","--sandbox","workspace-write","{prompt}"]',
     '["exec","resume","{resume_id}","--json","--sandbox","workspace-write","{prompt}"]',
     'codex exec resume {resume_id}',
     1, 1);
