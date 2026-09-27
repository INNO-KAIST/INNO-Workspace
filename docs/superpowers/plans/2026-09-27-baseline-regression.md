# Baseline critical-regression recovery Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development; implementation and review are separate.

**Goal:** 승인 MOD04에서 기준 모델도 독립 검토의 중대 회귀가 확인되면 이후 배정·fallback·복구에서 제외한다.
**Architecture:** 기존 withdrawn 상태와 원자 policy CAS를 재사용. 새로운 런타임/상태 저장소 없음. 기존 실행 배정은 불변, 정상 활성 후보까지 무조건 중단하지 않음.
**Spec:** docs/PRD.md MOD03/04/07. 알려진 baseline 회귀 gap 해소, 새 요구가 아님.

## Scope and verification
- [x] RED: active baseline critical(고정 포함), inactive baseline critical 후 active 후보 철회/만료, self-report 비차단, 중복 실행 및 state CAS, 증거 용량 초과 후 안전한 제외.
- [x] public/core/model-selection.mjs: baseline도 신뢰 중대 회귀 시 withdrawn. 유효하지 않은 baseline은 fallback/복구/승격 비교의 기준에서 제외. active baseline 철회는 검증된 복구 후보가 없으면 대기, pin 해제. 이전 배정 자료 변경 금지.
- [x] worker/model-policies.mjs의 trusted observation 및 용량 제한 예외 경로도 같은 규칙 적용; server/model-policies.mjs 공통 어댑터 통합 확인. 레거시 저장 상태에서 이미 기록된 신뢰 critical 근거가 있는 baseline을 조용히 다시 선택하지 않도록 선택·pin·승격 경계 검증.
- [x] 필요한 allocation/management 경계 테스트: unverified initial fallback이 격리된 baseline을 되살리지 못함. UI 기존 withdrawn/wait 표시 재사용, 신규 표시나 흐름이 필요하면 메인에 보고.
- [x] 구현자 대상 테스트 GREEN→독립 리뷰/검증→메인 전체 Node/dry-run/diff check→PROGRESS 및 개발 커밋. 실제 AI/운영 배포 없음.

## Files
public/core/model-selection.mjs, worker/model-policies.mjs, 필요한 경우 worker/allocation-policy.mjs 및 기존 policy management projection. tests/model-selection.test.mjs, tests/model-policies.test.mjs 및 관련 할당/관리 테스트. 메인은 docs 기록만 담당.

## Remaining
안전하게 제외된 기준 모델의 재자격 검증/새 기준선 생성은 무검증 자동 해제로 대체하지 않는다. 모델 최신화 전체와 공개 비교 실행은 이 단계 완료와 별개다.
