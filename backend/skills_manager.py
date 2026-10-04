"""
Velocity Skills Manager
Manages modular skill directories in data/skills/ with support for:
- Template seeding from config/skills.template/
- Dynamic skill discovery, manifest generation, and instruction loading
- Autonomous creation and updates by the AI assistant
- Slash command lookup and execution bindings

Strict design constraint: ZERO EMOJIS across all code, strings, and logs.
"""

import os
import json
import shutil
import logging
from typing import Dict, Any, List, Optional

logger = logging.getLogger("velocity.skills_manager")

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_SKILLS_DIR = os.path.join(BASE_DIR, "data", "skills")
TEMPLATE_SKILLS_DIR = os.path.join(BASE_DIR, "config", "skills.template")


def seed_skills_if_needed() -> None:
    """
    Copies default skill templates from config/skills.template/ into data/skills/
    if they do not already exist in data/skills/.
    """
    os.makedirs(DATA_SKILLS_DIR, exist_ok=True)
    if not os.path.isdir(TEMPLATE_SKILLS_DIR):
        logger.warning(f"Skills template directory not found at {TEMPLATE_SKILLS_DIR}")
        return

    for entry in os.listdir(TEMPLATE_SKILLS_DIR):
        src_path = os.path.join(TEMPLATE_SKILLS_DIR, entry)
        dst_path = os.path.join(DATA_SKILLS_DIR, entry)
        if os.path.isdir(src_path) and not os.path.exists(dst_path):
            try:
                shutil.copytree(src_path, dst_path)
                logger.info(f"Seeded skill template '{entry}' to {dst_path}")
            except Exception as e:
                logger.error(f"Failed to seed skill template '{entry}': {e}")


def list_skills() -> List[Dict[str, Any]]:
    """
    Scans data/skills/ and returns a list of all installed skills with their manifests.
    """
    seed_skills_if_needed()
    skills = []
    if not os.path.isdir(DATA_SKILLS_DIR):
        return skills

    for item in sorted(os.listdir(DATA_SKILLS_DIR)):
        item_path = os.path.join(DATA_SKILLS_DIR, item)
        manifest_path = os.path.join(item_path, "skill.json")
        if os.path.isdir(item_path) and os.path.isfile(manifest_path):
            try:
                with open(manifest_path, "r", encoding="utf-8") as f:
                    manifest = json.load(f)
                
                # Load instructions if present
                instructions_path = os.path.join(item_path, "instructions.md")
                if os.path.isfile(instructions_path):
                    with open(instructions_path, "r", encoding="utf-8") as inf:
                        manifest["instructions"] = inf.read()
                else:
                    manifest["instructions"] = ""

                skills.append(manifest)
            except Exception as e:
                logger.error(f"Error loading skill manifest at {manifest_path}: {e}")

    return skills


def get_skill(skill_id: str) -> Optional[Dict[str, Any]]:
    """
    Retrieves a single skill manifest and instructions by skill ID.
    """
    skill_dir = os.path.join(DATA_SKILLS_DIR, skill_id)
    manifest_path = os.path.join(skill_dir, "skill.json")
    if not os.path.isfile(manifest_path):
        return None

    try:
        with open(manifest_path, "r", encoding="utf-8") as f:
            manifest = json.load(f)

        instructions_path = os.path.join(skill_dir, "instructions.md")
        if os.path.isfile(instructions_path):
            with open(instructions_path, "r", encoding="utf-8") as inf:
                manifest["instructions"] = inf.read()
        else:
            manifest["instructions"] = ""

        return manifest
    except Exception as e:
        logger.error(f"Error reading skill '{skill_id}': {e}")
        return None


def get_skill_instructions(skill_id: str) -> Optional[str]:
    """
    Returns only the instructions.md content for a given skill.
    """
    skill = get_skill(skill_id)
    if skill:
        return skill.get("instructions", "")
    return None


def create_or_update_skill(
    skill_id: str,
    name: str,
    description: str,
    instructions: str,
    enabled: bool = True,
    slash_command: Optional[str] = None,
    allowed_tools: Optional[List[str]] = None,
    memory_files: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """
    Creates or updates a skill in data/skills/{skill_id}/.
    """
    skill_id_clean = "".join(c for c in skill_id.lower() if c.isalnum() or c in ("_", "-")).strip("_")
    if not skill_id_clean:
        raise ValueError("Invalid skill_id: must contain alphanumeric characters or underscores")

    skill_dir = os.path.join(DATA_SKILLS_DIR, skill_id_clean)
    os.makedirs(skill_dir, exist_ok=True)

    manifest_path = os.path.join(skill_dir, "skill.json")
    instructions_path = os.path.join(skill_dir, "instructions.md")

    manifest = {
        "id": skill_id_clean,
        "name": name.strip(),
        "description": description.strip(),
        "enabled": enabled,
        "slash_command": slash_command.strip() if slash_command else None,
        "allowed_tools": allowed_tools if allowed_tools is not None else [],
        "memory_files": memory_files if memory_files is not None else [],
    }

    # Write manifest atomically
    temp_manifest = f"{manifest_path}.tmp"
    with open(temp_manifest, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
    os.replace(temp_manifest, manifest_path)

    # Write instructions atomically
    temp_instructions = f"{instructions_path}.tmp"
    with open(temp_instructions, "w", encoding="utf-8") as f:
        f.write(instructions or "")
    os.replace(temp_instructions, instructions_path)

    manifest["instructions"] = instructions
    logger.info(f"Skill '{skill_id_clean}' saved successfully.")
    return manifest


def delete_skill(skill_id: str) -> bool:
    """
    Deletes a skill directory from data/skills/{skill_id}/.
    """
    skill_dir = os.path.join(DATA_SKILLS_DIR, skill_id)
    if os.path.isdir(skill_dir):
        try:
            shutil.rmtree(skill_dir)
            logger.info(f"Deleted skill directory {skill_dir}")
            return True
        except Exception as e:
            logger.error(f"Failed to delete skill directory {skill_dir}: {e}")
            return False
    return False


def find_skill_by_slash_command(command: str) -> Optional[Dict[str, Any]]:
    """
    Finds an enabled skill matching a slash command (e.g. '/briefing').
    """
    cmd = command.strip().split()[0].lower() if command else ""
    if not cmd.startswith("/"):
        return None

    skills = list_skills()
    for s in skills:
        if s.get("enabled", True) and s.get("slash_command"):
            if s["slash_command"].lower() == cmd:
                return s
    return None


def get_skills_prompt_manifest() -> str:
    """
    Generates a concise markdown manifest of enabled skills for Turn 0 system prompt injection.
    """
    skills = list_skills()
    enabled_skills = [s for s in skills if s.get("enabled", True)]
    if not enabled_skills:
        return "No external skills registered."

    lines = ["Available modular skills (you may invoke or follow their procedures when relevant):"]
    for s in enabled_skills:
        cmd_str = f" [Command: {s['slash_command']}]" if s.get("slash_command") else ""
        lines.append(f"- **{s['name']}** (id: `{s['id']}`){cmd_str}: {s['description']}")
    return "\n".join(lines)
