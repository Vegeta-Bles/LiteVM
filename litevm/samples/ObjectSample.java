public class ObjectSample {
    private int counter = 42;

    public ObjectSample() {
        this.counter = 7;
    }

    public int getCounter() {
        return counter;
    }

    public void bump(int delta) {
        counter += delta;
    }

    public static ObjectSample create(int base) {
        ObjectSample sample = new ObjectSample();
        sample.counter = base;
        return sample;
    }
}
