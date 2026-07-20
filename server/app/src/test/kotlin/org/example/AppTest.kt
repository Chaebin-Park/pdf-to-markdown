package org.example

import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Assertions.assertNotEquals

class AppTest {
    @Test
    fun jobIdsAreUnique() {
        assertNotEquals(JobManager.createJob(), JobManager.createJob())
    }
}
