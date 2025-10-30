"""
MeTTa-Inspired Knowledge Graph for Sui DeFi
============================================

A lightweight, pure-Python knowledge graph implementation inspired by
SingularityNET's MeTTa language and Distributed Atomspace concepts.

This module provides:
- Knowledge representation (facts, relationships, rules)
- Query engine (pattern matching, traversal)
- Logical inference (simple rule-based reasoning)

Designed to be Agentverse-compatible (no external dependencies).
"""

from typing import List, Dict, Any, Optional, Set, Tuple
import json


class KnowledgeGraph:
    """
    MeTTa-inspired knowledge graph using triple store pattern.

    Stores facts as (subject, predicate, object) triples.
    Example: ("Cetus", "is_type", "DEX")
    """

    def __init__(self):
        self.facts: Set[Tuple[str, str, str]] = set()
        self.rules: List[Dict[str, Any]] = []

    def add_fact(self, subject: str, predicate: str, obj: str):
        """Add a fact to the knowledge base"""
        self.facts.add((subject, predicate, obj))

    def add_facts_batch(self, facts: List[Tuple[str, str, str]]):
        """Add multiple facts at once"""
        for fact in facts:
            self.add_fact(*fact)

    def query(self, subject: Optional[str] = None,
              predicate: Optional[str] = None,
              obj: Optional[str] = None) -> List[Tuple[str, str, str]]:
        """
        Query the knowledge base with pattern matching.

        Use None as wildcard. Examples:
        - query("Cetus", None, None) -> All facts about Cetus
        - query(None, "supports_pair", "SUI/USDC") -> All DEXes supporting SUI/USDC
        - query(None, "is_type", "DEX") -> All DEXes
        """
        results = []
        for fact in self.facts:
            s, p, o = fact
            if (subject is None or subject == s) and \
               (predicate is None or predicate == p) and \
               (obj is None or obj == o):
                results.append(fact)
        return results

    def get_property(self, subject: str, predicate: str) -> Optional[str]:
        """Get a single property value"""
        results = self.query(subject, predicate, None)
        if results:
            return results[0][2]  # Return object
        return None

    def find_best_by_property(self, entity_type: str, property_name: str,
                              preferred_value: str) -> List[str]:
        """
        Find entities of a type with a specific property value.

        Example: Find DEXes with "high" liquidity
        """
        # Find all entities of this type
        entities = [s for s, p, o in self.query(None, "is_type", entity_type)]

        # Filter by property value
        results = []
        for entity in entities:
            value = self.get_property(entity, property_name)
            if value == preferred_value:
                results.append(entity)
        return results

    def traverse_path(self, start: str, predicates: List[str]) -> List[str]:
        """
        Traverse a path through the graph.

        Example: Find all tokens supported by a DEX
        traverse_path("Cetus", ["supports_token"])
        """
        current_nodes = [start]
        for predicate in predicates:
            next_nodes = []
            for node in current_nodes:
                results = self.query(node, predicate, None)
                next_nodes.extend([o for s, p, o in results])
            current_nodes = next_nodes
        return current_nodes

    def get_relationships(self, subject: str) -> Dict[str, List[str]]:
        """Get all relationships for an entity"""
        facts = self.query(subject, None, None)
        relationships = {}
        for s, p, o in facts:
            if p not in relationships:
                relationships[p] = []
            relationships[p].append(o)
        return relationships

    def infer_best_dex(self, coin_in: str, coin_out: str) -> Optional[str]:
        """
        Infer best DEX for a token pair using knowledge graph reasoning.

        Logic:
        1. Find DEXes that support the pair
        2. Filter by liquidity level (prefer "high")
        3. Filter by risk level (prefer "low")
        """
        pair = f"{coin_in}/{coin_out}"

        # Find DEXes supporting this pair
        supporting_dexes = [s for s, p, o in self.query(None, "supports_pair", pair)]

        if not supporting_dexes:
            return None

        # Score each DEX
        scores = {}
        for dex in supporting_dexes:
            score = 0

            # Check liquidity
            liquidity = self.get_property(dex, f"liquidity_{pair}")
            if liquidity == "high":
                score += 10
            elif liquidity == "medium":
                score += 5

            # Check risk
            risk = self.get_property(dex, "risk_level")
            if risk == "low":
                score += 10
            elif risk == "medium":
                score += 5

            scores[dex] = score

        # Return DEX with highest score
        if scores:
            return max(scores.items(), key=lambda x: x[1])[0]
        return supporting_dexes[0] if supporting_dexes else None

    def get_gas_estimate(self, operation: str) -> Optional[float]:
        """Get gas estimate for an operation"""
        gas_str = self.get_property(operation, "gas_estimate")
        if gas_str:
            try:
                return float(gas_str)
            except ValueError:
                pass
        return None

    def explain_reasoning(self, subject: str) -> str:
        """Generate human-readable explanation of facts about an entity"""
        facts = self.query(subject, None, None)
        if not facts:
            return f"No knowledge about {subject}"

        lines = [f"Knowledge about {subject}:"]
        for s, p, o in facts:
            lines.append(f"  - {p}: {o}")
        return "\n".join(lines)

    def to_json(self) -> str:
        """Export knowledge base to JSON"""
        return json.dumps({
            "facts": [list(fact) for fact in self.facts],
            "rules": self.rules
        }, indent=2)

    def from_json(self, json_str: str):
        """Import knowledge base from JSON"""
        data = json.loads(json_str)
        self.facts = set(tuple(fact) for fact in data.get("facts", []))
        self.rules = data.get("rules", [])


# Initialize Sui DeFi knowledge base
def create_sui_defi_knowledge_base() -> KnowledgeGraph:
    """
    Create and populate knowledge base with Sui DeFi knowledge.

    This is inspired by MeTTa's Distributed Atomspace concept:
    - Nodes: protocols, tokens, operations
    - Links: relationships between them
    - Properties: attributes and metadata
    """
    kg = KnowledgeGraph()

    # === DEX Protocols ===
    kg.add_facts_batch([
        ("Cetus", "is_type", "DEX"),
        ("Cetus", "blockchain", "Sui"),
        ("Cetus", "protocol_type", "AMM"),
        ("Cetus", "risk_level", "low"),
        ("Cetus", "audited", "true"),

        ("Turbos", "is_type", "DEX"),
        ("Turbos", "blockchain", "Sui"),
        ("Turbos", "protocol_type", "AMM"),
        ("Turbos", "risk_level", "medium"),
        ("Turbos", "audited", "true"),

        ("Aftermath", "is_type", "DEX"),
        ("Aftermath", "blockchain", "Sui"),
        ("Aftermath", "protocol_type", "Aggregator"),
        ("Aftermath", "risk_level", "medium"),
    ])

    # === Token Pairs & Liquidity ===
    kg.add_facts_batch([
        # Cetus pairs
        ("Cetus", "supports_pair", "SUI/USDC"),
        ("Cetus", "liquidity_SUI/USDC", "high"),
        ("Cetus", "supports_pair", "SUI/USDT"),
        ("Cetus", "liquidity_SUI/USDT", "high"),
        ("Cetus", "supports_pair", "USDC/USDT"),
        ("Cetus", "liquidity_USDC/USDT", "medium"),
        ("Cetus", "supports_pair", "SUI/WAL"),
        ("Cetus", "liquidity_SUI/WAL", "medium"),

        # Turbos pairs
        ("Turbos", "supports_pair", "SUI/USDC"),
        ("Turbos", "liquidity_SUI/USDC", "medium"),
        ("Turbos", "supports_pair", "SUI/USDT"),
        ("Turbos", "liquidity_SUI/USDT", "low"),

        # Aftermath pairs (aggregates others)
        ("Aftermath", "aggregates", "Cetus"),
        ("Aftermath", "aggregates", "Turbos"),
    ])

    # === NFT Marketplaces ===
    kg.add_facts_batch([
        ("TradePort", "is_type", "NFT_Marketplace"),
        ("TradePort", "blockchain", "Sui"),
        ("TradePort", "supports_operation", "mint"),
        ("TradePort", "supports_operation", "transfer"),
        ("TradePort", "supports_operation", "list"),
        ("TradePort", "fee_percentage", "2.5"),

        ("BlueMove", "is_type", "NFT_Marketplace"),
        ("BlueMove", "blockchain", "Sui"),
        ("BlueMove", "supports_operation", "mint"),
        ("BlueMove", "fee_percentage", "2.0"),
    ])

    # === Tokens with Real Testnet Addresses ===
    kg.add_facts_batch([
        # SUI Token
        ("SUI", "is_type", "Token"),
        ("SUI", "symbol", "SUI"),
        ("SUI", "decimals", "9"),
        ("SUI", "is_native", "true"),
        ("SUI", "coin_type", "0x2::sui::SUI"),
        ("SUI", "address", "0x2::sui::SUI"),

        # USDC Token (Testnet)
        ("USDC", "is_type", "Token"),
        ("USDC", "symbol", "USDC"),
        ("USDC", "decimals", "6"),
        ("USDC", "is_stablecoin", "true"),
        ("USDC", "coin_type", "0x0588cff9a50e0eaf4cd50d337c1a36570bc1517793fd3303e1513e8ad4d2aa96::usdc::USDC"),
        ("USDC", "address", "0x0588cff9a50e0eaf4cd50d337c1a36570bc1517793fd3303e1513e8ad4d2aa96::usdc::USDC"),

        # USDT Token (Testnet)
        ("USDT", "is_type", "Token"),
        ("USDT", "symbol", "USDT"),
        ("USDT", "decimals", "6"),
        ("USDT", "is_stablecoin", "true"),
        ("USDT", "coin_type", "0x50b3637dde9471e36dcb8b7d147a9e8de50a777181e7f1b11598e28d7bebf8c4::usdt::USDT"),
        ("USDT", "address", "0x50b3637dde9471e36dcb8b7d147a9e8de50a777181e7f1b11598e28d7bebf8c4::usdt::USDT"),

        # CETUS Token (Testnet)
        ("CETUS", "is_type", "Token"),
        ("CETUS", "symbol", "CETUS"),
        ("CETUS", "decimals", "9"),
        ("CETUS", "coin_type", "0xa6f859bee36f3882711be22cf468f0974eb318ec3b8fe9bcc5ed69311360a044::cetus::CETUS"),
        ("CETUS", "address", "0xa6f859bee36f3882711be22cf468f0974eb318ec3b8fe9bcc5ed69311360a044::cetus::CETUS"),

        # WAL Token (Testnet)
        ("WAL", "is_type", "Token"),
        ("WAL", "symbol", "WAL"),
        ("WAL", "decimals", "9"),
        ("WAL", "coin_type", "0x8270feb7375eee355e64fdb69c50abb6b5f9393a722883c1cf45f8e26048810a::wal::WAL"),
        ("WAL", "address", "0x8270feb7375eee355e64fdb69c50abb6b5f9393a722883c1cf45f8e26048810a::wal::WAL"),
    ])

    # === Operations & Gas Estimates ===
    kg.add_facts_batch([
        ("swap", "is_type", "Operation"),
        ("swap", "gas_estimate", "0.001"),
        ("swap", "requires_approval", "false"),

        ("mint_nft", "is_type", "Operation"),
        ("mint_nft", "gas_estimate", "0.01"),
        ("mint_nft", "requires_approval", "false"),

        ("transfer_nft", "is_type", "Operation"),
        ("transfer_nft", "gas_estimate", "0.002"),
        ("transfer_nft", "requires_approval", "false"),

        ("stake", "is_type", "Operation"),
        ("stake", "gas_estimate", "0.002"),
        ("stake", "requires_approval", "false"),
    ])

    # === Cetus Protocol Configuration (Testnet) ===
    kg.add_facts_batch([
        ("Cetus", "global_config", "0x9774e359588ead122af1c7e7f64e14ade261cfeecdb5d0eb4a5b3b4c8ab8bd3e"),
        ("Cetus", "network", "testnet"),
    ])

    return kg


# Global knowledge base instance
_knowledge_base: Optional[KnowledgeGraph] = None


def get_knowledge_base() -> KnowledgeGraph:
    """Get or create the global knowledge base instance"""
    global _knowledge_base
    if _knowledge_base is None:
        _knowledge_base = create_sui_defi_knowledge_base()
    return _knowledge_base


def query_knowledge(query_type: str, **kwargs) -> Any:
    """
    High-level query interface for agent tools.

    Query types:
    - "best_dex": Find best DEX for coin pair
    - "gas_estimate": Get gas estimate for operation
    - "supports_operation": Check if entity supports operation
    - "get_property": Get property value
    - "explain": Get explanation about entity
    - "coin_info": Get coin type address and decimals
    - "swap_params": Get all swap parameters for backend
    """
    kg = get_knowledge_base()

    if query_type == "best_dex":
        return kg.infer_best_dex(kwargs.get("coin_in"), kwargs.get("coin_out"))

    elif query_type == "gas_estimate":
        return kg.get_gas_estimate(kwargs.get("operation"))

    elif query_type == "supports_operation":
        entity = kwargs.get("entity")
        operation = kwargs.get("operation")
        results = kg.query(entity, "supports_operation", operation)
        return len(results) > 0

    elif query_type == "get_property":
        return kg.get_property(kwargs.get("subject"), kwargs.get("predicate"))

    elif query_type == "explain":
        return kg.explain_reasoning(kwargs.get("subject"))

    elif query_type == "find_by_type":
        entity_type = kwargs.get("entity_type")
        return [s for s, p, o in kg.query(None, "is_type", entity_type)]

    elif query_type == "coin_info":
        """Get complete coin information for swap"""
        coin_symbol = kwargs.get("coin_symbol", "").upper()
        coin_address = kg.get_property(coin_symbol, "coin_type")
        decimals_str = kg.get_property(coin_symbol, "decimals")

        if coin_address and decimals_str:
            return {
                "symbol": coin_symbol,
                "address": coin_address,
                "coinType": coin_address,
                "decimals": int(decimals_str)
            }
        return None

    elif query_type == "swap_params":
        """Build complete swap parameters for backend API"""
        coin_in = kwargs.get("coin_in", "").upper()
        coin_out = kwargs.get("coin_out", "").upper()

        # Get coin info
        coin_in_info = query_knowledge("coin_info", coin_symbol=coin_in)
        coin_out_info = query_knowledge("coin_info", coin_symbol=coin_out)

        if not coin_in_info or not coin_out_info:
            return None

        # Get best DEX
        best_dex = kg.infer_best_dex(coin_in, coin_out)

        # Get Cetus global config
        global_config = kg.get_property("Cetus", "global_config")

        return {
            "tokenFrom": coin_in_info,
            "tokenTo": coin_out_info,
            "dex": best_dex or "Cetus",
            "globalConfig": global_config,
            "network": "testnet"
        }

    return None
