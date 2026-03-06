declare module 'memoizee' {
  type MemoizeeOptions = {
    primitive?: boolean;
    max?: number;
  };

  function memoizee<F extends (...args: any[]) => any>(
    fn: F,
    options?: MemoizeeOptions
  ): F;

  export default memoizee;
}
