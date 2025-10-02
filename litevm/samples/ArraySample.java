public class ArraySample {
    public static int sum(int[] data) {
        int acc = 0;
        for (int i = 0; i < data.length; i++) {
            acc += data[i];
        }
        return acc;
    }

    public static int[] create(int size) {
        int[] arr = new int[size];
        for (int i = 0; i < size; i++) {
            arr[i] = i * 2;
        }
        return arr;
    }

    public static Object[] createObjects(int size) {
        Object[] arr = new Object[size];
        for (int i = 0; i < size; i++) {
            arr[i] = new Object();
        }
        return arr;
    }
}
