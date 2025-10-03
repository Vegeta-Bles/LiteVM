public class ExceptionSample {
    public static int safeDivide(int a, int b) {
        try {
            return divide(a, b);
        } catch (ArithmeticException ex) {
            return 0;
        }
    }

    public static int divide(int a, int b) {
        return a / b;
    }
}
