"""
Utility Functions for SuiVisor Multi-Agent System

Common helper functions used across all agents.
"""

import re
import json
import httpx
from datetime import datetime, timezone
from typing import Dict, Any, Optional, Tuple
from uuid import uuid4

from uagents import Context
from uagents_core.contrib.protocols.chat import (
    ChatMessage,
    ChatAcknowledgement,
    TextContent,
    EndSessionContent,
)


# ============================================================================
# CHAT PROTOCOL UTILITIES
# ============================================================================

def create_text_chat(text: str, end_session: bool = False) -> ChatMessage:
    """
    Create a ChatMessage with text content

    Args:
        text: The message text
        end_session: Whether to include end-session marker

    Returns:
        ChatMessage object ready to send
    """
    content = [TextContent(type="text", text=text)]
    if end_session:
        content.append(EndSessionContent(type="end-session"))

    return ChatMessage(
        timestamp=datetime.now(timezone.utc),
        msg_id=uuid4(),
        content=content,
    )


def extract_text_from_chat(msg: ChatMessage) -> str:
    """
    Extract all text content from a ChatMessage

    Args:
        msg: ChatMessage to extract from

    Returns:
        Concatenated text from all TextContent items
    """
    texts = []
    for item in msg.content:
        if isinstance(item, TextContent):
            texts.append(item.text)
    return " ".join(texts).strip()


def create_acknowledgement(msg_id: uuid4) -> ChatAcknowledgement:
    """
    Create a ChatAcknowledgement for a received message

    Args:
        msg_id: The message ID to acknowledge

    Returns:
        ChatAcknowledgement object
    """
    return ChatAcknowledgement(
        timestamp=datetime.now(timezone.utc),
        acknowledged_msg_id=msg_id,
    )


# ============================================================================
# SUI ADDRESS VALIDATION
# ============================================================================

def validate_sui_address(address: str) -> Tuple[bool, Optional[str]]:
    """
    Validate a Sui blockchain address

    Args:
        address: Address string to validate

    Returns:
        Tuple of (is_valid, error_message)
    """
    # Sui addresses are 64-character hex strings with 0x prefix
    if not address:
        return False, "Address is empty"

    if not address.startswith("0x"):
        return False, "Address must start with 0x"

    # Remove 0x prefix for validation
    hex_part = address[2:]

    if len(hex_part) != 64:
        return False, f"Address must be 64 hex characters (got {len(hex_part)})"

    if not re.match(r'^[0-9a-fA-F]{64}$', hex_part):
        return False, "Address contains invalid characters"

    return True, None


# ============================================================================
# NUMBER FORMATTING
# ============================================================================

def format_currency(amount: float, currency: str = "USD", decimals: int = 2) -> str:
    """
    Format a number as currency

    Args:
        amount: Amount to format
        currency: Currency symbol
        decimals: Number of decimal places

    Returns:
        Formatted currency string
    """
    if currency == "USD":
        return f"${amount:,.{decimals}f}"
    else:
        return f"{amount:,.{decimals}f} {currency}"


def format_percentage(value: float, decimals: int = 2) -> str:
    """
    Format a number as percentage

    Args:
        value: Value to format (0.1 = 10%)
        decimals: Number of decimal places

    Returns:
        Formatted percentage string
    """
    return f"{value * 100:.{decimals}f}%"


def format_token_amount(amount: float, token: str, decimals: int = 4) -> str:
    """
    Format token amount with symbol

    Args:
        amount: Amount to format
        token: Token symbol
        decimals: Number of decimal places

    Returns:
        Formatted token amount
    """
    return f"{amount:,.{decimals}f} {token}"


# ============================================================================
# HTTP UTILITIES
# ============================================================================

async def http_post(
    url: str,
    data: Dict[str, Any],
    headers: Optional[Dict[str, str]] = None,
    timeout: int = 30
) -> Tuple[bool, Optional[Dict[str, Any]], Optional[str]]:
    """
    Make HTTP POST request

    Args:
        url: URL to POST to
        data: JSON data to send
        headers: Optional HTTP headers
        timeout: Request timeout in seconds

    Returns:
        Tuple of (success, response_data, error_message)
    """
    default_headers = {"Content-Type": "application/json"}
    if headers:
        default_headers.update(headers)

    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                url,
                json=data,
                headers=default_headers,
                timeout=timeout
            )
            response.raise_for_status()
            return True, response.json(), None
    except httpx.HTTPStatusError as e:
        return False, None, f"HTTP {e.response.status_code}: {e.response.text}"
    except httpx.RequestError as e:
        return False, None, f"Request failed: {str(e)}"
    except Exception as e:
        return False, None, f"Unexpected error: {str(e)}"


async def http_get(
    url: str,
    params: Optional[Dict[str, Any]] = None,
    headers: Optional[Dict[str, str]] = None,
    timeout: int = 30
) -> Tuple[bool, Optional[Dict[str, Any]], Optional[str]]:
    """
    Make HTTP GET request

    Args:
        url: URL to GET from
        params: Optional query parameters
        headers: Optional HTTP headers
        timeout: Request timeout in seconds

    Returns:
        Tuple of (success, response_data, error_message)
    """
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                url,
                params=params,
                headers=headers,
                timeout=timeout
            )
            response.raise_for_status()
            return True, response.json(), None
    except httpx.HTTPStatusError as e:
        return False, None, f"HTTP {e.response.status_code}: {e.response.text}"
    except httpx.RequestError as e:
        return False, None, f"Request failed: {str(e)}"
    except Exception as e:
        return False, None, f"Unexpected error: {str(e)}"


# ============================================================================
# AGENT CONTEXT UTILITIES
# ============================================================================

def log_agent_activity(ctx: Context, activity: str, details: Optional[Dict[str, Any]] = None):
    """
    Log agent activity with structured format

    Args:
        ctx: Agent context
        activity: Activity description
        details: Optional additional details
    """
    log_msg = f"[{ctx.agent.name}] {activity}"
    if details:
        log_msg += f" | Details: {json.dumps(details)}"
    ctx.logger.info(log_msg)


async def send_with_retry(
    ctx: Context,
    destination: str,
    message: Any,
    max_retries: int = 3,
    retry_delay: float = 1.0
) -> Tuple[bool, Optional[str]]:
    """
    Send message with retry logic

    Args:
        ctx: Agent context
        destination: Destination agent address
        message: Message to send
        max_retries: Maximum number of retries
        retry_delay: Delay between retries in seconds

    Returns:
        Tuple of (success, error_message)
    """
    import asyncio

    for attempt in range(max_retries):
        try:
            await ctx.send(destination, message)
            return True, None
        except Exception as e:
            if attempt < max_retries - 1:
                ctx.logger.warning(f"Send failed (attempt {attempt + 1}/{max_retries}): {e}")
                await asyncio.sleep(retry_delay)
            else:
                return False, f"Failed after {max_retries} attempts: {str(e)}"

    return False, "Max retries exceeded"


# ============================================================================
# DATA VALIDATION
# ============================================================================

def validate_positive_number(value: float, name: str) -> Tuple[bool, Optional[str]]:
    """Validate that a number is positive"""
    if value <= 0:
        return False, f"{name} must be positive (got {value})"
    return True, None


def validate_percentage(value: float, name: str, min_val: float = 0.0, max_val: float = 1.0) -> Tuple[bool, Optional[str]]:
    """Validate that a value is within percentage range"""
    if not min_val <= value <= max_val:
        return False, f"{name} must be between {min_val} and {max_val} (got {value})"
    return True, None


def validate_token_symbol(symbol: str) -> Tuple[bool, Optional[str]]:
    """Validate token symbol format"""
    if not symbol or not symbol.strip():
        return False, "Token symbol cannot be empty"

    if not re.match(r'^[A-Z]{2,10}$', symbol.upper()):
        return False, f"Invalid token symbol format: {symbol}"

    return True, None


# ============================================================================
# TIMESTAMP UTILITIES
# ============================================================================

def get_current_timestamp() -> str:
    """Get current UTC timestamp as ISO string"""
    return datetime.now(timezone.utc).isoformat()


def parse_timestamp(timestamp_str: str) -> Optional[datetime]:
    """Parse ISO timestamp string to datetime"""
    try:
        return datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
    except Exception:
        return None


# ============================================================================
# ERROR HANDLING
# ============================================================================

def create_error_response(error_type: str, error_message: str, ctx: Context) -> Dict[str, Any]:
    """
    Create standardized error response

    Args:
        error_type: Type of error
        error_message: Error description
        ctx: Agent context

    Returns:
        Error response dictionary
    """
    return {
        "error": True,
        "error_type": error_type,
        "error_message": error_message,
        "agent": ctx.agent.name,
        "timestamp": get_current_timestamp(),
    }


def format_exception(e: Exception) -> str:
    """Format exception for logging"""
    return f"{type(e).__name__}: {str(e)}"
