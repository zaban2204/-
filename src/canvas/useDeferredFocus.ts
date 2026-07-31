import { useEffect, useRef } from 'react';

// 캔버스에서 새로 띄운 입력창에 포커스를 안전하게 주기 위한 훅.
//
// 같은 프레임에 focus()를 부르면 뒤따라오는 mousedown의 기본 동작(클릭한 요소로
// 포커스 이동)에 곧바로 빼앗긴다. 그래서 다음 프레임에 잡는다.
//
// hasFocusedRef는 "포커스를 실제로 받아본 적이 있는가"를 기록한다. 포커스를 받지
// 못한 채 들어온 blur를 그대로 확정 처리하면 빈 입력이 즉시 지워져 사용자에게는
// "클릭했는데 아무 일도 안 일어남"으로 보인다.
export function useDeferredFocus<T extends HTMLElement>(isEditing: boolean) {
  const ref = useRef<T>(null);
  const hasFocusedRef = useRef(false);

  useEffect(() => {
    if (!isEditing) {
      hasFocusedRef.current = false;
      return;
    }
    const raf = requestAnimationFrame(() => ref.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [isEditing]);

  return { ref, hasFocusedRef };
}
