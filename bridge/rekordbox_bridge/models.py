"""Versioned payload schema for Rekordbox Related Tracks bridge."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

PAYLOAD_SCHEMA_VERSION = 1


@dataclass
class RelatedTrackMember:
    master_content_id: str   # stable ID for matching to rekordbox_tracks
    position: int            # 1-based ordering within the list
    source_payload: Dict[str, Any] = field(default_factory=dict)


@dataclass
class RelatedTrackList:
    source_list_id: str
    parent_source_list_id: Optional[str]
    name: str
    sort_order: Optional[int]
    is_folder: bool
    attribute: int
    criteria_raw: Dict[str, Any]  # preserve unknown criteria exactly
    members: List[RelatedTrackMember]


@dataclass
class SourceInfo:
    rekordbox_database_id: Optional[str]
    rekordbox_version: Optional[str]
    device_name: Optional[str]


@dataclass
class BridgePayload:
    schema_version: int
    generated_at: str   # ISO 8601
    source: SourceInfo
    lists: List[RelatedTrackList]

    def to_dict(self) -> Dict[str, Any]:
        """Return dict safe for json.dumps, using camelCase keys."""
        return {
            "schemaVersion": self.schema_version,
            "generatedAt": self.generated_at,
            "source": {
                "rekordboxDatabaseId": self.source.rekordbox_database_id,
                "rekordboxVersion": self.source.rekordbox_version,
                "deviceName": self.source.device_name,
            },
            "lists": [
                {
                    "sourceListId": lst.source_list_id,
                    "parentSourceListId": lst.parent_source_list_id,
                    "name": lst.name,
                    "sortOrder": lst.sort_order,
                    "isFolder": lst.is_folder,
                    "attribute": lst.attribute,
                    "criteriaRaw": lst.criteria_raw,
                    "members": [
                        {
                            "masterContentId": m.master_content_id,
                            "position": m.position,
                            "sourcePayload": m.source_payload,
                        }
                        for m in lst.members
                    ],
                }
                for lst in self.lists
            ],
        }
